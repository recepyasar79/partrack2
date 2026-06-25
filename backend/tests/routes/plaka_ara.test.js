const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');

let guv, guvToken;

beforeAll(async () => {
  guv = await createTestUser({ kullanici_adi: 'gpara', rol: 'guvenlik' });
  guvToken = makeToken({ id: guv.id, kullanici_adi: 'gpara', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([guv]);
});

const auth = (r) => r.set('Authorization', `Bearer ${guvToken}`);

async function createMisafir(daireId, plaka) {
  await db('misafir_araclar').insert({
    daire_id: daireId,
    plaka,
    baslangic_tarihi: db.fn.now(),
    bitis_tarihi: db.fn.now(),
    ekleyen_user_id: guv.id,
    site_id: 1,
  });
}

describe('GET /kontroller/plaka-ara — hızlı plaka önerisi', () => {
  test('son 3 hane kayıtlı + misafir araçlardan eşleşenleri döner', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    const b2 = await createTestDaire({ daire_no: 'B2' });
    await createTestArac({ daire_id: a1.id, plaka: '34ABC716' });
    await createMisafir(b2.id, '06XYZ716');
    // Eşleşmeyen kontrol kaydı
    await createTestArac({ daire_id: a1.id, plaka: '34ABC100' });

    const res = await auth(request(app).get('/api/kontroller/plaka-ara').query({ q: '716' }));
    expect(res.status).toBe(200);
    const plakalar = res.body.sonuclar.map((s) => s.plaka).sort();
    expect(plakalar).toEqual(['06XYZ716', '34ABC716']);
    const kayitli = res.body.sonuclar.find((s) => s.plaka === '34ABC716');
    expect(kayitli.kaynak).toBe('kayitli');
    expect(kayitli.daire_no).toBe('A1');
    const misafir = res.body.sonuclar.find((s) => s.plaka === '06XYZ716');
    expect(misafir.kaynak).toBe('misafir');
    expect(misafir.daire_no).toBe('B2');
  });

  test('ends-with eşleşir — ortada geçen plaka düşmez', async () => {
    const a1 = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: a1.id, plaka: '34AB7160' }); // 716 ortada
    await createTestArac({ daire_id: a1.id, plaka: '34AB1716' }); // 716 sonda

    const res = await auth(request(app).get('/api/kontroller/plaka-ara').query({ q: '716' }));
    const plakalar = res.body.sonuclar.map((s) => s.plaka);
    expect(plakalar).toContain('34AB1716');
    expect(plakalar).not.toContain('34AB7160');
  });

  test('2 karakterden kısa sorgu boş döner', async () => {
    const res = await auth(request(app).get('/api/kontroller/plaka-ara').query({ q: '7' }));
    expect(res.status).toBe(200);
    expect(res.body.sonuclar).toEqual([]);
  });

  test('token olmadan 401', async () => {
    const res = await request(app).get('/api/kontroller/plaka-ara').query({ q: '716' });
    expect(res.status).toBe(401);
  });
});
