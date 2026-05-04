const { app, request, db, makeToken, createTestUser, createTestDaire, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let adminId;
let admin, guard;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'dadmin', rol: 'yonetici' });
  guard = await createTestUser({ kullanici_adi: 'dguard', rol: 'guvenlik' });
  adminId = admin.id;
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'dadmin', rol: 'yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'dguard', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([admin, guard]);
});

describe('GET /api/daireler', () => {
  test('tum aktif daireler listelenir', async () => {
    await createTestDaire({ daire_no: 'A1' });
    await createTestDaire({ daire_no: 'B5' });
    const res = await request(app)
      .get('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.daireler).toHaveLength(2);
  });

  test('blok filtresi calisir', async () => {
    await createTestDaire({ daire_no: 'A1' });
    await createTestDaire({ daire_no: 'B5' });
    const res = await request(app)
      .get('/api/daireler?blok=A')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.daireler).toHaveLength(1);
    expect(res.body.daireler[0].daire_no).toBe('A1');
  });

  test('arama filtresi calisir', async () => {
    await createTestDaire({ daire_no: 'A1', sahip_ad: 'Ahmet Yilmaz' });
    await createTestDaire({ daire_no: 'B2', sahip_ad: 'Mehmet Demir' });
    const res = await request(app)
      .get('/api/daireler?q=Ahmet')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.daireler).toHaveLength(1);
  });

  test('token olmadan 401 doner', async () => {
    const res = await request(app).get('/api/daireler');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/daireler', () => {
  test('yonetici daire ekler (201)', async () => {
    const res = await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        daire_no: 'A1',
        sahip_ad: 'Ali Veli',
        sahip_tel: '05551234567',
        kvkk_riza: true,
        bildirim_opt_in: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.daire.daire_no).toBe('A1');
  });

  test('guvenlik daire ekleyemez (403)', async () => {
    const res = await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        daire_no: 'B2',
        sahip_ad: 'Test',
        sahip_tel: '05551234567',
        kvkk_riza: true,
      });
    expect(res.status).toBe(403);
  });

  test('gecersiz daire_no ile 400 doner', async () => {
    const res = await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        daire_no: 'E1',
        sahip_ad: 'Test',
        sahip_tel: '05551234567',
        kvkk_riza: true,
      });
    expect(res.status).toBe(400);
  });

  test('ayni daire_no 2 kez eklenemez (409)', async () => {
    await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        daire_no: 'C10',
        sahip_ad: 'Test',
        sahip_tel: '05551234567',
        kvkk_riza: true,
      });
    const res = await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        daire_no: 'C10',
        sahip_ad: 'Baska',
        sahip_tel: '05559876543',
        kvkk_riza: true,
      });
    expect(res.status).toBe(409);
  });

  test('kvkk_riza olmadan 400 doner', async () => {
    const res = await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        daire_no: 'D1',
        sahip_ad: 'Test',
        sahip_tel: '05551234567',
      });
    expect(res.status).toBe(400);
  });

  test('gecersiz telefon ile 400 doner', async () => {
    const res = await request(app)
      .post('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        daire_no: 'D1',
        sahip_ad: 'Test',
        sahip_tel: '5551234567',
        kvkk_riza: true,
      });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/daireler/:id', () => {
  test('yonetici daireyi gunceller', async () => {
    const daire = await createTestDaire({ daire_no: 'A2', sahip_ad: 'Eski Ad' });
    const res = await request(app)
      .put(`/api/daireler/${daire.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sahip_ad: 'Yeni Ad' });
    expect(res.status).toBe(200);
    expect(res.body.daire.sahip_ad).toBe('Yeni Ad');
  });

  test('olmayan daire icin 404 doner', async () => {
    const res = await request(app)
      .put('/api/daireler/9999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sahip_ad: 'Test' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/daireler/:id', () => {
  test('yonetici daireyi soft delete yapar', async () => {
    const daire = await createTestDaire({ daire_no: 'A3' });
    const res = await request(app)
      .delete(`/api/daireler/${daire.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const deleted = await db('daireler').where({ id: daire.id }).first();
    expect(deleted.aktif).toBe(false);
  });

  test('silinen daire listede gorunmez', async () => {
    const daire = await createTestDaire({ daire_no: 'A4' });
    const delRes = await request(app)
      .delete(`/api/daireler/${daire.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);
    const listRes = await request(app)
      .get('/api/daireler')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.daireler.find((d) => d.daire_no === 'A4')).toBeUndefined();
  });
});

describe('POST /api/daireler/:id/sahip-degistir', () => {
  test('sahip degisimi tarihceye yazar', async () => {
    const daire = await createTestDaire({ daire_no: 'A5', sahip_ad: 'Eski Sahip', sahip_tel: '05551112233' });
    const res = await request(app)
      .post(`/api/daireler/${daire.id}/sahip-degistir`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        yeni_sahip_ad: 'Yeni Sahip',
        yeni_sahip_tel: '05554445566',
        kvkk_riza: true,
        bildirim_opt_in: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.daire.sahip_ad).toBe('Yeni Sahip');
    const tarihce = await db('daire_sahip_tarihce').where({ daire_id: daire.id });
    expect(tarihce).toHaveLength(1);
    expect(tarihce[0].sahip_ad).toBe('Eski Sahip');
  });
});

describe('POST /api/daireler/bulk-import', () => {
  test('gecerli CSV satirlari eklenir', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        satirlar: [
          { daire_no: 'A20', sahip_ad: 'Toplu 1', sahip_tel: '05550001111', kvkk_riza: true },
          { daire_no: 'A21', sahip_ad: 'Toplu 2', sahip_tel: '05550002222', kvkk_riza: true },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.eklenenler).toHaveLength(2);
    expect(res.body.hatalar).toHaveLength(0);
  });

  test('gecersiz satirlar hata raporuna girer', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        satirlar: [
          { daire_no: 'A22', sahip_ad: 'Gecerli', sahip_tel: '05550003333', kvkk_riza: true },
          { daire_no: 'Z1', sahip_ad: 'Gecersiz', sahip_tel: '05550004444', kvkk_riza: true },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.eklenenler).toHaveLength(1);
    expect(res.body.hatalar).toHaveLength(1);
  });

  test('guvenlik bulk-import yapamaz (403)', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ satirlar: [] });
    expect(res.status).toBe(403);
  });
});
