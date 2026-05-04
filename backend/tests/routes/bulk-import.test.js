const { app, request, makeToken, createTestUser, createTestDaire, db } = require('../helpers');

let adminToken;
let guardToken;

beforeAll(async () => {
  const admin = await createTestUser({ kullanici_adi: 'biadmin', rol: 'yonetici' });
  const guard = await createTestUser({ kullanici_adi: 'biguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'biadmin', rol: 'yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'biguard', rol: 'guvenlik' });
});

describe('POST /api/daireler/bulk-import', () => {
  test('gecerli CSV satirlari toplu eklenir', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        satirlar: [
          { daire_no: 'A10', sahip_ad: 'Toplu 1', sahip_tel: '05550001111', kvkk_riza: true },
          { daire_no: 'A11', sahip_ad: 'Toplu 2', sahip_tel: '05550002222', kvkk_riza: true },
          { daire_no: 'A12', sahip_ad: 'Toplu 3', sahip_tel: '05550003333', kvkk_riza: true },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.eklenenler).toHaveLength(3);
    expect(res.body.hatalar).toHaveLength(0);
  });

  test('1 satir gecersizse o satir skip + hata raporu', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        satirlar: [
          { daire_no: 'A13', sahip_ad: 'Gecerli', sahip_tel: '05550004444', kvkk_riza: true },
          { daire_no: 'Z1', sahip_ad: 'Gecersiz Blok', sahip_tel: '05550005555', kvkk_riza: true },
          { daire_no: 'A14', sahip_ad: 'Gecerli 2', sahip_tel: '05550006666', kvkk_riza: true },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.eklenenler).toHaveLength(2);
    expect(res.body.hatalar).toHaveLength(1);
    expect(res.body.hatalar[0].satir).toBe(2);
  });

  test('ayni plaka 2 satirda ikinci reddedilir', async () => {
    await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        satirlar: [
          { daire_no: 'A15', sahip_ad: 'Dup 1', sahip_tel: '05550007777', kvkk_riza: true },
        ],
      });
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        satirlar: [
          { daire_no: 'A15', sahip_ad: 'Dup 2', sahip_tel: '05550008888', kvkk_riza: true },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.hatalar).toHaveLength(1);
  });

  test('guvenlik toplu ice aktaramaz (403)', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ satirlar: [] });
    expect(res.status).toBe(403);
  });

  test('bos satir listesi 400 doner', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ satirlar: [] });
    expect(res.status).toBe(400);
  });

  test('array olmayan satir 400 doner', async () => {
    const res = await request(app)
      .post('/api/daireler/bulk-import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ satirlar: 'not-array' });
    expect(res.status).toBe(400);
  });
});
