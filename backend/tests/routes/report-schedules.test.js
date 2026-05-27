const { app, request, makeToken, createTestUser, db, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let admin;
let guard;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'schedadmin', rol: 'site_yonetici' });
  guard = await createTestUser({ kullanici_adi: 'schedguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'schedadmin', rol: 'site_yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'schedguard', rol: 'guvenlik' });
});

beforeEach(async () => {
  await db('report_schedules').del();
  await cleanupTables([admin, guard]);
});

describe('GET /api/raporlar/schedules', () => {
  test('site içinde yer alan schedules listelenir', async () => {
    await db('report_schedules').insert({
      site_id: 1, email: 'a@a.com', frequency: 'weekly', enabled: true,
    });
    const res = await request(app)
      .get('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.schedules.length).toBe(1);
    expect(res.body.schedules[0].email).toBe('a@a.com');
  });

  test('guvenlik da listeleyebilir (read)', async () => {
    const res = await request(app)
      .get('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(200);
  });

  test('auth gerekli', async () => {
    const res = await request(app).get('/api/raporlar/schedules');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/raporlar/schedules', () => {
  test('site_yonetici yeni schedule ekleyebilir', async () => {
    const res = await request(app)
      .post('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'Test@Site.com', frequency: 'weekly' });
    expect(res.status).toBe(201);
    expect(res.body.schedule.email).toBe('test@site.com'); // lowercase'lendi
    expect(res.body.schedule.enabled).toBe(true);
  });

  test('guvenlik 403', async () => {
    const res = await request(app)
      .post('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ email: 'x@x.com', frequency: 'daily' });
    expect(res.status).toBe(403);
  });

  test('geçersiz email → 400', async () => {
    const res = await request(app)
      .post('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email', frequency: 'weekly' });
    expect(res.status).toBe(400);
  });

  test('geçersiz frequency → 400', async () => {
    const res = await request(app)
      .post('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'a@b.com', frequency: 'yearly' });
    expect(res.status).toBe(400);
  });

  test('aynı email + frequency 2. eklenince 409', async () => {
    await request(app)
      .post('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dup@x.com', frequency: 'weekly' });
    const res = await request(app)
      .post('/api/raporlar/schedules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dup@x.com', frequency: 'weekly' });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/raporlar/schedules/:id', () => {
  test('enabled toggle yapılabilir', async () => {
    const [s] = await db('report_schedules').insert({
      site_id: 1, email: 'a@a.com', frequency: 'daily', enabled: true,
    }).returning('*');
    const res = await request(app)
      .put(`/api/raporlar/schedules/${s.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.schedule.enabled).toBe(false);
  });

  test('var olmayan id → 404', async () => {
    const res = await request(app)
      .put('/api/raporlar/schedules/99999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);
  });

  test('boş patch → 400', async () => {
    const [s] = await db('report_schedules').insert({
      site_id: 1, email: 'a@a.com', frequency: 'daily',
    }).returning('*');
    const res = await request(app)
      .put(`/api/raporlar/schedules/${s.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/raporlar/schedules/:id', () => {
  test('site_yonetici silebilir', async () => {
    const [s] = await db('report_schedules').insert({
      site_id: 1, email: 'a@a.com', frequency: 'daily',
    }).returning('*');
    const res = await request(app)
      .delete(`/api/raporlar/schedules/${s.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
    const row = await db('report_schedules').where({ id: s.id }).first();
    expect(row).toBeUndefined();
  });

  test('guvenlik silmeye çalışırsa 403', async () => {
    const [s] = await db('report_schedules').insert({
      site_id: 1, email: 'a@a.com', frequency: 'daily',
    }).returning('*');
    const res = await request(app)
      .delete(`/api/raporlar/schedules/${s.id}`)
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(403);
  });
});
