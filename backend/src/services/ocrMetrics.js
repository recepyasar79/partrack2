/**
 * OCR Metrics — her recognize çağrısını ölçer ve sonra kullanıcının
 * plakayı düzeltip düzeltmediğini eşler.
 *
 * Doğruluk metriği = was_corrected_by_user=false / toplam.
 * p95 gecikme = ocr_metrics.elapsed_ms üzerinden.
 *
 * Logging asla istek akışını blokeleyemez — yutulan hata yalnızca console
 * uyarısı bırakır, OCR cevabı yine kullanıcıya döner.
 */
const db = require('../db');

/**
 * pythonOcr.recognizePlate'in döndüğü cevabı ve (varsa) bağlı kontrol
 * id'sini alıp ocr_metrics tablosuna satır yazar.
 *
 * @param {object} params
 * @param {number|null} params.gunlukKontrolId  Kontrol kaydı id'si (null = upload başarısız)
 * @param {string} [params.engine='easyocr']    OCR motoru etiketi (ileride 'plate_recognizer', 'paddleocr' vb.)
 * @param {object} params.ocrResult             pythonOcr.recognizePlate'in cevabı
 * @returns {Promise<number|null>} oluşturulan metric id (yoksa null)
 */
async function recordOcrCall({ gunlukKontrolId = null, engine = 'easyocr', ocrResult, siteId }) {
  if (!ocrResult) return null;
  if (siteId == null) {
    console.warn('[ocrMetrics] siteId eksik — kayıt atlandı');
    return null;
  }
  try {
    const [row] = await db('ocr_metrics')
      .insert({
        gunluk_kontrol_id: gunlukKontrolId,
        site_id: siteId,
        ocr_engine: engine,
        raw_text: ocrResult.rawText || null,
        plate_returned: ocrResult.plate || null,
        confidence: typeof ocrResult.confidence === 'number' ? ocrResult.confidence : null,
        strategy: ocrResult.strategy || null,
        elapsed_ms: ocrResult.elapsedMs ?? null,
        ocr_ok: !!ocrResult.ok,
        error: ocrResult.error || null,
      })
      .returning('id');
    return row?.id ?? row ?? null;
  } catch (err) {
    console.warn('[ocrMetrics] insert başarısız:', err.message);
    return null;
  }
}

/**
 * Kullanıcı PATCH /:id/plaka ile düzelttiğinde son metric satırını
 * (gunlukKontrolId için en yeni) was_corrected_by_user=true yapar.
 *
 * @param {number} gunlukKontrolId
 * @param {string} correctedTo  Yeni doğru plaka
 */
async function markCorrected(gunlukKontrolId, correctedTo) {
  if (!gunlukKontrolId) return;
  try {
    // En yeni metric satırını işaretle. Aynı kontrol için birden fazla OCR
    // koşusu olursa (ileride retry/A-B) yine en son olanı işaretliyoruz.
    const latest = await db('ocr_metrics')
      .where({ gunluk_kontrol_id: gunlukKontrolId })
      .orderBy('id', 'desc')
      .first();
    if (!latest) return;
    await db('ocr_metrics')
      .where({ id: latest.id })
      .update({
        was_corrected_by_user: true,
        corrected_to: (correctedTo || '').toUpperCase().slice(0, 16),
        corrected_at: db.fn.now(),
      });
  } catch (err) {
    console.warn('[ocrMetrics] markCorrected başarısız:', err.message);
  }
}

/**
 * Yönetici paneli için özet — son N gün doğruluk + gecikme.
 *
 * @param {number} days  Kaç günlük pencere (default 7)
 * @returns {Promise<{total, ok, accuracy, p50_ms, p95_ms, by_engine}>}
 */
async function getSummary(days = 7, siteId) {
  if (siteId == null) {
    return { days, total: 0, untouched: 0, accuracy: null, p50_ms: null, p95_ms: null, by_engine: [] };
  }
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const totals = await db('ocr_metrics')
    .where('site_id', siteId)
    .andWhere('created_at', '>=', sinceIso)
    .andWhere('ocr_ok', true)
    .whereNotNull('plate_returned')
    .andWhere('plate_returned', '!=', '')
    .select(
      db.raw('count(*)::int as total'),
      db.raw('sum(case when was_corrected_by_user = false then 1 else 0 end)::int as untouched')
    )
    .first();

  // p50/p95 — pg-mem percentile_cont desteklemediği için JS tarafında hesapla
  const latencies = await db('ocr_metrics')
    .where('site_id', siteId)
    .andWhere('created_at', '>=', sinceIso)
    .whereNotNull('elapsed_ms')
    .pluck('elapsed_ms');
  latencies.sort((a, b) => a - b);
  const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);

  const byEngine = await db('ocr_metrics')
    .where('site_id', siteId)
    .andWhere('created_at', '>=', sinceIso)
    .andWhere('ocr_ok', true)
    .whereNotNull('plate_returned')
    .andWhere('plate_returned', '!=', '')
    .groupBy('ocr_engine')
    .select(
      'ocr_engine',
      db.raw('count(*)::int as total'),
      db.raw('sum(case when was_corrected_by_user = false then 1 else 0 end)::int as untouched'),
      db.raw('avg(elapsed_ms)::int as avg_ms')
    );

  const total = totals?.total || 0;
  const untouched = totals?.untouched || 0;
  return {
    days,
    total,
    untouched,
    accuracy: total ? +(untouched / total).toFixed(4) : null,
    p50_ms: pct(latencies, 0.5),
    p95_ms: pct(latencies, 0.95),
    by_engine: byEngine.map((r) => ({
      engine: r.ocr_engine,
      total: r.total,
      untouched: r.untouched,
      accuracy: r.total ? +(r.untouched / r.total).toFixed(4) : null,
      avg_ms: r.avg_ms,
    })),
  };
}

module.exports = { recordOcrCall, markCorrected, getSummary };
