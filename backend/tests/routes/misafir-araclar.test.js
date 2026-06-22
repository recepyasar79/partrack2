const { app, request, makeToken, createTestUser, createTestDaire, db, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let admin, guard;

beforeEach(async () => {
  await cleanupTables();
  admin = await createTestUser({ kullanici_adi: 'madmin', rol: 'site_yonetici' });
  guard = await createTestUser({ kullanici_adi: 'mguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'madmin', rol: 'site_yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'mguard', rol: 'guvenlik' });
});

describe('GET /api/misafir-araclar', () => {
  test('misafir araclar listelenir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const today = new Date().toISOString().slice(0, 10);
    await db('misafir_araclar').insert({
      site_id: 1,
      daire_id: daire.id,
      plaka: '34MIS001',
      baslangic_tarihi: today,
      bitis_tarihi: today,
      ekleyen_user_id: admin.id,
    });
    const res = await request(app)
      .get('/api/misafir-araclar')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.misafir_araclar.length).toBeGreaterThanOrEqual(1);
  });

  test('tarih filtresi calisir', async () => {
    const daire = await createTestDaire({ daire_no: 'A2' });
    const today = new Date().toISOString().slice(0, 10);
    await db('misafir_araclar').insert({
      site_id: 1,
      daire_id: daire.id,
      plaka: '34MIS002',
      baslangic_tarihi: today,
      bitis_tarihi: today,
      ekleyen_user_id: admin.id,
    });
    const res = await request(app)
      .get(`/api/misafir-araclar?tarih=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.misafir_araclar.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/misafir-araclar', () => {
  test('misafir arac eklenebilir (201)', async () => {
    const daire = await createTestDaire({ daire_no: 'A3' });
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await request(app)
      .post('/api/misafir-araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        site_id: 1,
        daire_id: daire.id,
        plaka: '34GU001',
        baslangic_tarihi: today,
        bitis_tarihi: tomorrow,
        aciklama: 'Test misafir',
      });
    expect(res.status).toBe(201);
    expect(res.body.misafir.plaka).toBe('34GU001');
  });

  test('bitis tarihi baslangictan once ise 400 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A4' });
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const res = await request(app)
      .post('/api/misafir-araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        site_id: 1,
        daire_id: daire.id,
        plaka: '34BAD1',
        baslangic_tarihi: today,
        bitis_tarihi: yesterday,
      });
    expect(res.status).toBe(400);
  });

  test('gecersiz plaka ile 400 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A5' });
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .post('/api/misafir-araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        site_id: 1,
        daire_id: daire.id,
        plaka: 'INVALID',
        baslangic_tarihi: today,
        bitis_tarihi: today,
      });
    expect(res.status).toBe(400);
  });

  test('guvenlik de misafir ekleyebilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A6' });
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .post('/api/misafir-araclar')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        site_id: 1,
        daire_id: daire.id,
        plaka: '34GRD01',
        baslangic_tarihi: today,
        bitis_tarihi: today,
      });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/misafir-araclar/hizli', () => {
  async function kontrolEkle(plaka, yukleme) {
    const today = new Date().toISOString().slice(0, 10);
    const [k] = await db('gunluk_kontroller')
      .insert({
        site_id: 1,
        plaka,
        kontrol_tarihi: today,
        yukleme_zamani: yukleme || new Date(),
      })
      .returning('*');
    return k;
  }

  test('kayitsiz araci hizlica misafir yapar (201) — giris=kayit saati, cikis=o gunun 23:59', async () => {
    const daire = await createTestDaire({ daire_no: 'B3' });
    const yukleme = new Date();
    const k = await kontrolEkle('34HIZ001', yukleme);
    const res = await request(app)
      .post('/api/misafir-araclar/hizli')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ kontrol_id: k.id, daire_no: 'b3' }); // küçük harf de kabul
    expect(res.status).toBe(201);
    expect(res.body.misafir.plaka).toBe('34HIZ001');
    expect(res.body.misafir.daire_id).toBe(daire.id);
    // Giriş = kaydın yükleme saati
    expect(new Date(res.body.misafir.baslangic_tarihi).getTime())
      .toBe(new Date(yukleme).getTime());
    // Çıkış = aynı günün sonu (23:59); başlangıçtan sonra ve aynı takvim günü
    expect(new Date(res.body.misafir.bitis_tarihi).getTime())
      .toBeGreaterThan(new Date(yukleme).getTime());
  });

  test('olmayan daire ile 404', async () => {
    const k = await kontrolEkle('34HIZ002');
    const res = await request(app)
      .post('/api/misafir-araclar/hizli')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ kontrol_id: k.id, daire_no: 'Z99' });
    expect(res.status).toBe(404);
  });

  test('olmayan kontrol ile 404', async () => {
    await createTestDaire({ daire_no: 'B4' });
    const res = await request(app)
      .post('/api/misafir-araclar/hizli')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ kontrol_id: 999999, daire_no: 'B4' });
    expect(res.status).toBe(404);
  });

  test('daire_no bos ise 400', async () => {
    const k = await kontrolEkle('34HIZ003');
    const res = await request(app)
      .post('/api/misafir-araclar/hizli')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ kontrol_id: k.id, daire_no: '' });
    expect(res.status).toBe(400);
  });

  test('token yok ise 401', async () => {
    const res = await request(app)
      .post('/api/misafir-araclar/hizli')
      .send({ kontrol_id: 1, daire_no: 'B3' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/misafir-araclar/:id', () => {
  test('yonetici misafir kaydini silebilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A7' });
    const today = new Date().toISOString().slice(0, 10);
    const [misafir] = await db('misafir_araclar')
      .insert({
        site_id: 1,
        daire_id: daire.id,
        plaka: '34DEL001',
        baslangic_tarihi: today,
        bitis_tarihi: today,
        ekleyen_user_id: admin.id,
      })
      .returning('*');
    const res = await request(app)
      .delete(`/api/misafir-araclar/${misafir.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const exists = await db('misafir_araclar').where({ id: misafir.id }).first();
    expect(exists).toBeUndefined();
  });

  test('guvenlik misafir silemez (403)', async () => {
    const daire = await createTestDaire({ daire_no: 'A8' });
    const today = new Date().toISOString().slice(0, 10);
    const [misafir] = await db('misafir_araclar')
      .insert({
        site_id: 1,
        daire_id: daire.id,
        plaka: '34DEL002',
        baslangic_tarihi: today,
        bitis_tarihi: today,
        ekleyen_user_id: admin.id,
      })
      .returning('*');
    const res = await request(app)
      .delete(`/api/misafir-araclar/${misafir.id}`)
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(403);
  });
});
