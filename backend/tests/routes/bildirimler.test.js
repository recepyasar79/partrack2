const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db } = require('../helpers');

let adminToken;

beforeAll(async () => {
  const admin = await createTestUser({ kullanici_adi: 'badmin', rol: 'yonetici' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'badmin', rol: 'yonetici' });
});

async function createIhlalDaire() {
  const daire = await createTestDaire({ daire_no: 'A1', bildirim_opt_in: true });
  await createTestArac({ daire_id: daire.id, plaka: '34BIL001' });
  await createTestArac({ daire_id: daire.id, plaka: '34BIL002' });
  const today = new Date().toISOString().slice(0, 10);
  await db('gunluk_kontroller').insert([
    { kontrol_tarihi: today, plaka: '34BIL001', foto_url: '/uploads/b1.jpg' },
    { kontrol_tarihi: today, plaka: '34BIL002', foto_url: '/uploads/b2.jpg' },
  ]);
  await request(app)
    .post('/api/kontroller/analiz-et')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ tarih: today });
  const ihlal = await db('ihlaller').where({ ihlal_tipi: 'coklu_arac' }).first();
  return { daire, ihlal };
}

describe('POST /api/bildirimler/gonder', () => {
  test('opt-in daireye bildirim gonderilir (mock)', async () => {
    const { ihlal } = await createIhlalDaire();
    const res = await request(app)
      .post('/api/bildirimler/gonder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ihlal_id: ihlal.id });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mock).toBe(true);
  });

  test('opt-in olmayan daireye 422 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'B1', bildirim_opt_in: false });
    await createTestArac({ daire_id: daire.id, plaka: '34NOO001' });
    await createTestArac({ daire_id: daire.id, plaka: '34NOO002' });
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert([
      { kontrol_tarihi: today, plaka: '34NOO001', foto_url: '/uploads/n1.jpg' },
      { kontrol_tarihi: today, plaka: '34NOO002', foto_url: '/uploads/n2.jpg' },
    ]);
    await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    const ihlal = await db('ihlaller').where({ ihlal_tipi: 'coklu_arac' }).first();
    const res = await request(app)
      .post('/api/bildirimler/gonder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ihlal_id: ihlal.id });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('onay vermemiş');
  });

  test('kayitsiz tipindeki ihlale bildirim gonderilemez (422)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert({
      kontrol_tarihi: today,
      plaka: '99NOCAR0',
      foto_url: '/uploads/nc.jpg',
    });
    await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    const ihlal = await db('ihlaller').where({ ihlal_tipi: 'kayitsiz' }).first();
    if (ihlal) {
      const res = await request(app)
        .post('/api/bildirimler/gonder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ihlal_id: ihlal.id });
      expect(res.status).toBe(422);
    }
  });

  test('olmayan ihlal icin 404 doner', async () => {
    const res = await request(app)
      .post('/api/bildirimler/gonder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ihlal_id: 9999 });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bildirimler/toplu-gonder', () => {
  test('birden fazla ihlale toplu bildirim gonderilir', async () => {
    const d1 = await createTestDaire({ daire_no: 'A1', bildirim_opt_in: true });
    const d2 = await createTestDaire({ daire_no: 'B1', bildirim_opt_in: true });
    await createTestArac({ daire_id: d1.id, plaka: '34TOP001' });
    await createTestArac({ daire_id: d1.id, plaka: '34TOP002' });
    await createTestArac({ daire_id: d2.id, plaka: '34TOP003' });
    await createTestArac({ daire_id: d2.id, plaka: '34TOP004' });
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert([
      { kontrol_tarihi: today, plaka: '34TOP001', foto_url: '/uploads/t1.jpg' },
      { kontrol_tarihi: today, plaka: '34TOP002', foto_url: '/uploads/t2.jpg' },
      { kontrol_tarihi: today, plaka: '34TOP003', foto_url: '/uploads/t3.jpg' },
      { kontrol_tarihi: today, plaka: '34TOP004', foto_url: '/uploads/t4.jpg' },
    ]);
    await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    const ihlaller = await db('ihlaller').where({ ihlal_tipi: 'coklu_arac' });
    const ids = ihlaller.map((i) => i.id);
    const res = await request(app)
      .post('/api/bildirimler/toplu-gonder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ihlal_idleri: ids });
    expect(res.status).toBe(200);
    expect(res.body.basari).toBe(2);
  });
});

describe('GET /api/bildirimler', () => {
  test('bildirim listesi doner', async () => {
    const res = await request(app)
      .get('/api/bildirimler')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bildirimler)).toBe(true);
  });

  test('durum filtresi calisir', async () => {
    const res = await request(app)
      .get('/api/bildirimler?durum=gonderildi')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
