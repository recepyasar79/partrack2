const { app, request, makeToken, createTestUser, createTestDaire, createTestArac, db, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let admin, guard;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'aadmin', rol: 'site_yonetici' });
  guard = await createTestUser({ kullanici_adi: 'aguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'aadmin', rol: 'site_yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'aguard', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([admin, guard]);
});

describe('GET /api/araclar', () => {
  test('tum aktif araclar listelenir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    await createTestArac({ daire_id: daire.id, plaka: '34ABC123' });
    await createTestArac({ daire_id: daire.id, plaka: '34DEF456' });
    const res = await request(app)
      .get('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.araclar).toHaveLength(2);
  });

  test('blok filtresi calisir', async () => {
    const daireA = await createTestDaire({ daire_no: 'A1' });
    const daireB = await createTestDaire({ daire_no: 'B1' });
    await createTestArac({ daire_id: daireA.id, plaka: '34AAA111' });
    await createTestArac({ daire_id: daireB.id, plaka: '34BBB222' });
    const res = await request(app)
      .get('/api/araclar?blok=A')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.araclar).toHaveLength(1);
    expect(res.body.araclar[0].daire_no).toBe('A1');
  });

  test('arama filtresi calisir', async () => {
    const daire = await createTestDaire({ daire_no: 'A5' });
    await createTestArac({ daire_id: daire.id, plaka: '34XYZ789' });
    const res = await request(app)
      .get('/api/araclar?q=34XYZ')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.araclar).toHaveLength(1);
  });
});

describe('POST /api/araclar', () => {
  test('yonetici araca plaka ekler (201)', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const res = await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ daire_id: daire.id, plaka: '34ABC123' });
    expect(res.status).toBe(201);
    expect(res.body.arac.plaka).toBe('34ABC123');
  });

  test('ayni plaka 2 farkli daireye eklenemez (409)', async () => {
    const daire1 = await createTestDaire({ daire_no: 'A1' });
    const daire2 = await createTestDaire({ daire_no: 'B1' });
    await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ daire_id: daire1.id, plaka: '34DUP001' });
    const res = await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ daire_id: daire2.id, plaka: '34DUP001' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('başka bir aktif daireye kayıtlı');
  });

  test('guvenlik plaka ekleyemez (403)', async () => {
    const daire = await createTestDaire({ daire_no: 'A2' });
    const res = await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ daire_id: daire.id, plaka: '34GUARD1' });
    expect(res.status).toBe(403);
  });

  test('gecersiz plaka ile 400 doner', async () => {
    const daire = await createTestDaire({ daire_no: 'A3' });
    const res = await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ daire_id: daire.id, plaka: 'INVALID' });
    expect(res.status).toBe(400);
  });

  test('yabanci plaka kabul edilir (sitede yabanci plakali sakinler var)', async () => {
    const daire = await createTestDaire({ daire_no: 'A5' });
    const res = await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ daire_id: daire.id, plaka: 'CB 8950 HE' });
    expect(res.status).toBe(201);
    expect(res.body.arac.plaka).toBe('CB8950HE');
  });

  test('bir daireye sinirsiz plaka eklenebilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A4' });
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post('/api/araclar')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ daire_id: daire.id, plaka: `34P${String(i).padStart(3, '0')}` });
      expect(res.status).toBe(201);
    }
    const all = await db('araclar').where({ daire_id: daire.id, aktif: true });
    expect(all).toHaveLength(5);
  });

  test('plaka normalization (bosluk buyuk harf)', async () => {
    const daire = await createTestDaire({ daire_no: 'A6' });
    const res = await request(app)
      .post('/api/araclar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ daire_id: daire.id, plaka: ' 34 abc 99 ' });
    expect(res.status).toBe(201);
    expect(res.body.arac.plaka).toBe('34ABC99');
  });
});

describe('DELETE /api/araclar/:id', () => {
  test('yonetici araci soft delete yapar', async () => {
    const daire = await createTestDaire({ daire_no: 'A7' });
    const arac = await createTestArac({ daire_id: daire.id, plaka: '34DEL001' });
    const res = await request(app)
      .delete(`/api/araclar/${arac.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const deleted = await db('araclar').where({ id: arac.id }).first();
    expect(deleted.aktif).toBe(false);
  });
});

describe('GET /api/araclar/daire/:daire_id', () => {
  test('dairenin aracları listelenir', async () => {
    const daire = await createTestDaire({ daire_no: 'A8' });
    await createTestArac({ daire_id: daire.id, plaka: '34D1001' });
    await createTestArac({ daire_id: daire.id, plaka: '34D1002' });
    const res = await request(app)
      .get(`/api/araclar/daire/${daire.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.araclar).toHaveLength(2);
  });
});
