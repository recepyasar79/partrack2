const { recordOcrCall, markCorrected, getSummary } = require('../src/services/ocrMetrics');
const db = require('../src/db');

const DB_AVAILABLE = !!(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);
const describeIfDb = DB_AVAILABLE ? describe : describe.skip;

describeIfDb('ocrMetrics', () => {
  beforeEach(async () => {
    await db('ocr_metrics').del();
    await db('gunluk_kontroller').del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function makeKontrol(plaka = '34TST001') {
    const [row] = await db('gunluk_kontroller')
      .insert({
        kontrol_tarihi: new Date().toISOString().slice(0, 10),
        plaka,
        foto_url: '/uploads/dummy.jpg',
      })
      .returning('*');
    return row;
  }

  test('recordOcrCall: başarılı OCR sonucu kaydeder', async () => {
    const kontrol = await makeKontrol();
    const id = await recordOcrCall({
      gunlukKontrolId: kontrol.id,
      engine: 'easyocr',
      ocrResult: {
        ok: true,
        plate: '34ABC123',
        confidence: 0.87,
        strategy: 'full-0/joined',
        elapsedMs: 412,
        rawText: '34 ABC 123',
      },
    });
    expect(id).toBeGreaterThan(0);

    const row = await db('ocr_metrics').where({ id }).first();
    expect(row.gunluk_kontrol_id).toBe(kontrol.id);
    expect(row.plate_returned).toBe('34ABC123');
    expect(Number(row.confidence)).toBeCloseTo(0.87, 4);
    expect(row.elapsed_ms).toBe(412);
    expect(row.ocr_ok).toBe(true);
    expect(row.was_corrected_by_user).toBe(false);
  });

  test('recordOcrCall: başarısız OCR sonucu (ok=false) yine kaydeder', async () => {
    const kontrol = await makeKontrol('');
    const id = await recordOcrCall({
      gunlukKontrolId: kontrol.id,
      ocrResult: { ok: false, plate: '', error: 'Python OCR unreachable: ECONNREFUSED' },
    });
    expect(id).toBeGreaterThan(0);
    const row = await db('ocr_metrics').where({ id }).first();
    expect(row.ocr_ok).toBe(false);
    expect(row.error).toContain('ECONNREFUSED');
  });

  test('recordOcrCall: null result no-op', async () => {
    const id = await recordOcrCall({ ocrResult: null });
    expect(id).toBeNull();
  });

  test('markCorrected: en son metric satırını işaretler', async () => {
    const kontrol = await makeKontrol();
    await recordOcrCall({
      gunlukKontrolId: kontrol.id,
      ocrResult: { ok: true, plate: '34ABC123', confidence: 0.6, elapsedMs: 500 },
    });
    await markCorrected(kontrol.id, '34ABC124');

    const row = await db('ocr_metrics').where({ gunluk_kontrol_id: kontrol.id }).first();
    expect(row.was_corrected_by_user).toBe(true);
    expect(row.corrected_to).toBe('34ABC124');
    expect(row.corrected_at).toBeTruthy();
  });

  test('markCorrected: metric yoksa sessizce geçer', async () => {
    await expect(markCorrected(99999, '34X')).resolves.toBeUndefined();
  });

  test('getSummary: doğruluk ve p95 hesaplar', async () => {
    const k1 = await makeKontrol('34A1');
    const k2 = await makeKontrol('34A2');
    const k3 = await makeKontrol('34A3');
    await recordOcrCall({
      gunlukKontrolId: k1.id,
      ocrResult: { ok: true, plate: '34A1', confidence: 0.9, elapsedMs: 300 },
    });
    await recordOcrCall({
      gunlukKontrolId: k2.id,
      ocrResult: { ok: true, plate: '34A2', confidence: 0.9, elapsedMs: 600 },
    });
    await recordOcrCall({
      gunlukKontrolId: k3.id,
      ocrResult: { ok: true, plate: '34BAD', confidence: 0.4, elapsedMs: 2000 },
    });
    await markCorrected(k3.id, '34A3');

    const s = await getSummary(7);
    expect(s.total).toBe(3);
    expect(s.untouched).toBe(2);
    expect(s.accuracy).toBeCloseTo(2 / 3, 2);
    expect(s.p50_ms).toBeGreaterThanOrEqual(300);
    expect(s.p95_ms).toBeGreaterThanOrEqual(s.p50_ms);
    expect(s.by_engine.length).toBeGreaterThanOrEqual(1);
    const easy = s.by_engine.find((e) => e.engine === 'easyocr');
    expect(easy.total).toBe(3);
    expect(easy.untouched).toBe(2);
  });
});
