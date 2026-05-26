const { app, request, makeToken, createTestUser, createTestDaire, cleanupTables } = require('../helpers');

let adminToken;
let guardToken;
let admin, guard;

beforeAll(async () => {
  admin = await createTestUser({ kullanici_adi: 'auadmin', rol: 'site_yonetici' });
  guard = await createTestUser({ kullanici_adi: 'auguard', rol: 'guvenlik' });
  adminToken = makeToken({ id: admin.id, kullanici_adi: 'auadmin', rol: 'site_yonetici' });
  guardToken = makeToken({ id: guard.id, kullanici_adi: 'auguard', rol: 'guvenlik' });
});

beforeEach(async () => {
  await cleanupTables([admin, guard]);
});

describe('GET /api/audit-log', () => {
  test('yonetici audit log listeleyebilir', async () => {
    const res = await request(app)
      .get('/api/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.kayitlar)).toBe(true);
  });

  test('guvenlik audit log listeleyemez (403)', async () => {
    const res = await request(app)
      .get('/api/audit-log')
      .set('Authorization', `Bearer ${guardToken}`);
    expect(res.status).toBe(403);
  });

  test('user_id filtresi calisir', async () => {
    const res = await request(app)
      .get(`/api/audit-log?user_id=1`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('tablo filtresi calisir', async () => {
    const res = await request(app)
      .get('/api/audit-log?tablo=daireler')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('limit parametresi calisir', async () => {
    const res = await request(app)
      .get('/api/audit-log?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kayitlar.length).toBeLessThanOrEqual(5);
  });

  test('daire guncellemesi audit_loga yazilir', async () => {
    const daire = await createTestDaire({ daire_no: 'A1' });
    const res = await request(app)
      .put(`/api/daireler/${daire.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sahip_ad: 'Guncellenmis Ad' });
    expect(res.status).toBe(200);
    const logRes = await request(app)
      .get('/api/audit-log?tablo=daireler')
      .set('Authorization', `Bearer ${adminToken}`);
    const auditKayit = logRes.body.kayitlar.find(
      (k) => k.eylem === 'guncelle' && k.kayit_id === daire.id
    );
    expect(auditKayit).toBeDefined();
  });
});
