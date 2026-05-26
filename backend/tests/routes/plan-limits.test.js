/**
 * Faz Ü2.2/Ü2.3 entegrasyon testleri — plan limit hook'ları + override.
 *
 * Stratejik test sitesi oluşturup limit'i 1'e indiriyoruz (override ile);
 * 2. eklemede 402 dönmesi beklenir.
 */
const {
  app, request, db, makeToken,
  createTestSite, createTestUser, createTestDaire,
  cleanupTables,
} = require('../helpers');

describe('Plan limit hook\'ları', () => {
  let siteSmall, adminSmall, tokenSmall, superAdmin, tokenSuper;

  beforeEach(async () => {
    await cleanupTables();
    superAdmin = await createTestUser({
      kullanici_adi: 'plsuper', rol: 'superadmin', site_id: null,
    });
    tokenSuper = makeToken({
      id: superAdmin.id, kullanici_adi: 'plsuper', rol: 'superadmin', site_id: null,
    });
    // Override ile limit'i 1'e indirilmiş test site'i
    siteSmall = await createTestSite({
      ad: 'Limit Test', slug: 'limit-test', plan: 'baslangic',
    });
    await db('sites').where({ id: siteSmall.id }).update({
      plan_limits: JSON.stringify({ daire_max: 1, user_max: 1 }),
    });
    adminSmall = await createTestUser({
      kullanici_adi: 'plsm_admin', rol: 'site_yonetici', site_id: siteSmall.id,
    });
    tokenSmall = makeToken({
      id: adminSmall.id, kullanici_adi: 'plsm_admin', rol: 'site_yonetici', site_id: siteSmall.id,
    });
  });

  afterAll(async () => {
    await cleanupTables();
    await db.destroy();
  });

  describe('POST /api/daireler — daire_max', () => {
    test('1. daire OK (201), 2. daire 402', async () => {
      const r1 = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({
          daire_no: 'A1', sahip_ad: 'Sahip 1', sahip_tel: '05551110001',
          kvkk_riza: true,
        });
      expect(r1.status).toBe(201);

      const r2 = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({
          daire_no: 'A2', sahip_ad: 'Sahip 2', sahip_tel: '05551110002',
          kvkk_riza: true,
        });
      expect(r2.status).toBe(402);
      expect(r2.body.limit).toBe('daire_max');
      expect(r2.body.current).toBe(1);
      expect(r2.body.max).toBe(1);
    });

    test('soft-deleted daire reactivate limit\'i artırmaz', async () => {
      // 1. daire ekle, sonra sil (soft), aktif sayı 0'a düşer.
      // Sonra aynı daire_no'yu yeniden gönder → reactivate, limit'i geçmez.
      const r1 = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({
          daire_no: 'B1', sahip_ad: 'B Sahip', sahip_tel: '05552220001',
          kvkk_riza: true,
        });
      expect(r1.status).toBe(201);
      const daireId = r1.body.daire.id;
      await db('daireler').where({ id: daireId }).update({ aktif: false });

      const r2 = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({
          daire_no: 'B1', sahip_ad: 'B Yeni', sahip_tel: '05552220002',
          kvkk_riza: true,
        });
      expect(r2.status).toBe(201);
    });
  });

  describe('POST /api/sites/:id/users — user_max', () => {
    test('superadmin kullanıcı ekler, limit dolduğunda 402', async () => {
      // siteSmall'a zaten 1 user (adminSmall) var, user_max=1 → ikinci ekleme 402
      const r = await request(app)
        .post(`/api/sites/${siteSmall.id}/users`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ kullanici_adi: 'plsm_g1', sifre: 'GuardPass1!', rol: 'guvenlik' });
      expect(r.status).toBe(402);
      expect(r.body.limit).toBe('user_max');
    });
  });

  describe('POST /api/auth/register — user_max', () => {
    test('site_yonetici güvenlik eklerken limit doluysa 402', async () => {
      const r = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({ kullanici_adi: 'reg_g1', sifre: 'GuardPass1!', rol: 'guvenlik' });
      expect(r.status).toBe(402);
      expect(r.body.limit).toBe('user_max');
    });
  });

  describe('PATCH /api/sites/:id — plan_limits override', () => {
    test('superadmin plan_limits override eder, limit genişler', async () => {
      // daire_max'i 5'e çıkar
      const rPatch = await request(app)
        .patch(`/api/sites/${siteSmall.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ plan_limits: { daire_max: 5, user_max: 1 } });
      expect(rPatch.status).toBe(200);
      expect(rPatch.body.site.plan_limits.daire_max).toBe(5);

      // Şimdi 2. daire eklemek mümkün
      const r1 = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({
          daire_no: 'A1', sahip_ad: 'Sahip One', sahip_tel: '05551110001', kvkk_riza: true,
        });
      expect(r1.status).toBe(201);
      const r = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenSmall}`)
        .send({
          daire_no: 'A2', sahip_ad: 'Sahip Two', sahip_tel: '05551110002', kvkk_riza: true,
        });
      expect(r.status).toBe(201);
    });

    test('plan_limits = null → defaults restore', async () => {
      const r = await request(app)
        .patch(`/api/sites/${siteSmall.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ plan_limits: null });
      expect(r.status).toBe(200);
      expect(r.body.site.plan_limits).toBeNull();
    });

    test('plan_limits geçersiz anahtar → 400', async () => {
      const r = await request(app)
        .patch(`/api/sites/${siteSmall.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ plan_limits: { foto_max: 100 } });
      expect(r.status).toBe(400);
    });
  });

  describe('GET /api/sites/:id — limits dönülür', () => {
    test('site detail efektif limits içerir', async () => {
      const r = await request(app)
        .get(`/api/sites/${siteSmall.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(200);
      expect(r.body.limits).toBeDefined();
      expect(r.body.limits.daire_max).toBe(1);
      expect(r.body.limits.user_max).toBe(1);
    });
  });
});
