const { app, request, makeToken, createTestUser, createTestDaire, db, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let admin, guard;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'madmin', rol: 'yonetici' });
  guard = await createTestUser({ kullanici_adi: 'mguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'madmin', rol: 'yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'mguard', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([admin, guard]);
});

describe('GET /api/misafir-araclar', () => {
  test('misafir araclar listelenir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const today = new Date().toISOString().slice(0, 10);
    await db('misafir_araclar').insert({
      daire_id: daire.id,
      plaka: '34MIS001',
      baslangic_tarihi: today,
      bitis_tarihi: today,
      ekleyen_user_id: adminToken,
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
      daire_id: daire.id,
      plaka: '34MIS002',
      baslangic_tarihi: today,
      bitis_tarihi: today,
      ekleyen_user_id: adminToken,
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
        daire_id: daire.id,
        plaka: '34GUEST1',
        baslangic_tarihi: today,
        bitis_tarihi: tomorrow,
        aciklama: 'Test misafir',
      });
    expect(res.status).toBe(201);
    expect(res.body.misafir.plaka).toBe('34GUEST1');
  });

  test('bitis tarihi baslangictan once ise 400 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A4' });
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const res = await request(app)
      .post('/api/misafir-araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
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
        daire_id: daire.id,
        plaka: '34GUARD',
        baslangic_tarihi: today,
        bitis_tarihi: today,
      });
    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/misafir-araclar/:id', () => {
  test('yonetici misafir kaydini silebilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A7' });
    const today = new Date().toISOString().slice(0, 10);
    const [misafir] = await db('misafir_araclar')
      .insert({
        daire_id: daire.id,
        plaka: '34DEL001',
        baslangic_tarihi: today,
        bitis_tarihi: today,
        ekleyen_user_id: 1,
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
        daire_id: daire.id,
        plaka: '34DEL002',
        baslangic_tarihi: today,
        bitis_tarihi: today,
        ekleyen_user_id: 1,
      })
      .returning('*');
    const res = await request(app)
      .delete(`/api/misafir-araclar/${misafir.id}`)
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(403);
  });
});
