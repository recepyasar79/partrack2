const { app, request, makeToken, createTestUser, createTestDaire, db, cleanupTables } = require('../helpers');

let adminToken;
let admin;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'sdadmin', rol: 'site_yonetici' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'sdadmin', rol: 'site_yonetici' });
});

beforeEach(async () => {
  await cleanupTables([admin]);
});

describe('POST /api/daireler/:id/sahip-degistir', () => {
  test('eski sahip tarihçeye gider, yeni sahip atanır', async () => {
    const daire = await createTestDaire({ daire_no: 'A1', sahip_ad: 'Eski Sahip', sahip_tel: '05551112233' });
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
    expect(res.body.daire.sahip_tel).toBe('05554445566');
    const tarihce = await db('daire_sahip_tarihce').where({ daire_id: daire.id });
    expect(tarihce).toHaveLength(1);
    expect(tarihce[0].sahip_ad).toBe('Eski Sahip');
    expect(tarihce[0].sahip_tel).toBe('05551112233');
  });

  test('gecersiz telefon ile 400 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A2' });
    const res = await request(app)
      .post(`/api/daireler/${daire.id}/sahip-degistir`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        yeni_sahip_ad: 'Test',
        yeni_sahip_tel: '5551234567',
        kvkk_riza: true,
      });
    expect(res.status).toBe(400);
  });

  test('kvkk_riza olmadan 400 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A3' });
    const res = await request(app)
      .post(`/api/daireler/${daire.id}/sahip-degistir`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        yeni_sahip_ad: 'Test',
        yeni_sahip_tel: '05551234567',
      });
    expect(res.status).toBe(400);
  });

  test('olmayan daire icin 404 doner', async () => {
    const res = await request(app)
      .post('/api/daireler/9999/sahip-degistir')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        yeni_sahip_ad: 'Test',
        yeni_sahip_tel: '05551234567',
        kvkk_riza: true,
      });
    expect(res.status).toBe(404);
  });

  test('gecmis ihlal raporları eski sahibe atfedilmis kalir', async () => {
    const daire = await createTestDaire({ daire_no: 'A4', sahip_ad: 'Ihlal Sahibi' });
    await request(app)
      .post(`/api/daireler/${daire.id}/sahip-degistir`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        yeni_sahip_ad: 'Yeni Sahip',
        yeni_sahip_tel: '05551234567',
        kvkk_riza: true,
      });
    const tarihce = await db('daire_sahip_tarihce').where({ daire_id: daire.id });
    expect(tarihce[0].sahip_ad).toBe('Ihlal Sahibi');
  });
});
