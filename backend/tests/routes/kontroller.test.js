const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');

let adminToken;
let admin;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'kadmin', rol: 'yonetici' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'kadmin', rol: 'yonetici' });
});

beforeEach(async () => {
  await cleanupTables([admin]);
});

describe('POST /api/kontroller/foto-upload', () => {
  test('foto yuklenir ve kontrol kaydi olusturulur', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34UPLOAD' });
    const buffer = Buffer.alloc(1024);
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('foto', buffer, 'test.jpg')
      .field('plaka', '34UPLOAD');
    expect(res.status).toBe(201);
    expect(res.body.kontrol.foto_url).toBeDefined();
  });

  test('plaka olmadan da yuklenir', async () => {
    const buffer = Buffer.alloc(1024);
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('foto', buffer, 'nopla.jpg');
    expect(res.status).toBe(201);
    expect(res.body.kontrol.plaka).toBe('');
  });

  test('token olmadan 401 doner', async () => {
    const buffer = Buffer.alloc(1024);
    const res = await request(app)
      .post('/api/kontroller/foto-upload')
      .attach('foto', buffer, 'noauth.jpg');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/kontroller', () => {
  test('bugunk kontroller listelenir', async () => {
    await db('gunluk_kontroller').insert({
      kontrol_tarihi: new Date().toISOString().slice(0, 10),
      plaka: '34LIST01',
      foto_url: '/uploads/test.jpg',
    });
    const res = await request(app)
      .get('/api/kontroller')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kontroller.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /api/kontroller/:id/plaka', () => {
  test('kontrol plakasi duzeltilir', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        kontrol_tarihi: new Date().toISOString().slice(0, 10),
        plaka: '',
        foto_url: '/uploads/fix.jpg',
      })
      .returning('*');
    const res = await request(app)
      .patch(`/api/kontroller/${kontrol.id}/plaka`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plaka: '34FIXED' });
    expect(res.status).toBe(200);
    expect(res.body.kontrol.plaka).toBe('34FIXED');
  });
});

describe('DELETE /api/kontroller/:id', () => {
  test('kontrol kaydi silinir', async () => {
    const [kontrol] = await db('gunluk_kontroller')
      .insert({
        kontrol_tarihi: new Date().toISOString().slice(0, 10),
        plaka: '34DELETE',
        foto_url: '/uploads/del.jpg',
      })
      .returning('*');
    const res = await request(app)
      .delete(`/api/kontroller/${kontrol.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const exists = await db('gunluk_kontroller').where({ id: kontrol.id }).first();
    expect(exists).toBeUndefined();
  });
});

describe('POST /api/kontroller/analiz-et', () => {
  test('2 plakali daire ihlal verir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34ANA001' });
    await createTestArac({ daire_id: daire.id, plaka: '34ANA002' });
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert([
      { kontrol_tarihi: today, plaka: '34ANA001', foto_url: '/uploads/a1.jpg' },
      { kontrol_tarihi: today, plaka: '34ANA002', foto_url: '/uploads/a2.jpg' },
    ]);
    const res = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res.status).toBe(200);
    expect(res.body.ihlaller).toHaveLength(1);
    expect(res.body.ihlaller[0].daire_no).toBe('A1');
  });

  test('kayitsiz plaka ihlal verir', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert({
      kontrol_tarihi: today,
      plaka: '99UNREG0',
      foto_url: '/uploads/unreg.jpg',
    });
    const res = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res.status).toBe(200);
    expect(res.body.kayitsiz_plakalar).toContain('99UNREG0');
  });

  test('idempotent: ayni gun 2. cagri mevcut kaydi update eder', async () => {
    const daire = await createTestDaire({ daire_no: 'B1' });
    await createTestArac({ daire_id: daire.id, plaka: '34IDEM01' });
    await createTestArac({ daire_id: daire.id, plaka: '34IDEM02' });
    await createTestArac({ daire_id: daire.id, plaka: '34IDEM03' });
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert([
      { kontrol_tarihi: today, plaka: '34IDEM01', foto_url: '/uploads/i1.jpg' },
      { kontrol_tarihi: today, plaka: '34IDEM02', foto_url: '/uploads/i2.jpg' },
    ]);
    const res1 = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res1.status).toBe(200);
    expect(res1.body.ihlaller).toHaveLength(1);
    expect(res1.body.ihlaller[0].plakalar).toHaveLength(2);

    await db('gunluk_kontroller').insert({
      kontrol_tarihi: today,
      plaka: '34IDEM03',
      foto_url: '/uploads/i3.jpg',
    });
    const res2 = await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    expect(res2.status).toBe(200);
    expect(res2.body.ihlaller).toHaveLength(1);
    expect(res2.body.ihlaller[0].plakalar).toHaveLength(3);
  });
});

describe('GET /api/kontroller/ihlaller', () => {
  test('ihlal listesi tarih filtresiyle doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34IHLL01' });
    await createTestArac({ daire_id: daire.id, plaka: '34IHLL02' });
    const today = new Date().toISOString().slice(0, 10);
    await db('gunluk_kontroller').insert([
      { kontrol_tarihi: today, plaka: '34IHLL01', foto_url: '/uploads/h1.jpg' },
      { kontrol_tarihi: today, plaka: '34IHLL02', foto_url: '/uploads/h2.jpg' },
    ]);
    await request(app)
      .post('/api/kontroller/analiz-et')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tarih: today });
    const res = await request(app)
      .get('/api/kontroller/ihlaller')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ihlaller.length).toBeGreaterThanOrEqual(1);
  });
});
