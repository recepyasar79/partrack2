/**
 * Multi-tenant izolasyon testleri — Faz Ü1.7.
 *
 * Bu testler **kritik**. Bir route'ta `WHERE site_id` unutulursa cross-site
 * data leak olur. Burada iki ayrı site oluşturup, A'nın user'ının B'nin
 * verisine erişemediğini doğruluyoruz.
 *
 * Tüm domain endpoint'leri için: liste, detay, mutating (UPDATE/DELETE)
 * pathlerinde scoping çalışıyor mu kontrol ediyoruz.
 */
const {
  app, request, db, makeToken,
  createTestSite, createTestUser, createTestDaire, createTestArac,
  cleanupTables,
} = require('../helpers');

describe('Multi-tenant izolasyon', () => {
  let siteA, siteB, superAdmin, adminA, adminB, guvenlikA;
  let daireA1, daireB1, aracA1, aracB1;
  let tokenSuper, tokenAdminA, tokenAdminB, tokenGuvenlikA;

  beforeAll(async () => {
    await cleanupTables();

    // Site A: default site (id=1). Site B: yeni.
    siteA = await db('sites').where({ id: 1 }).first();
    siteB = await createTestSite({ ad: 'Site B', slug: 'site-b' });

    superAdmin = await createTestUser({
      kullanici_adi: 'super', rol: 'superadmin', site_id: null,
    });
    adminA = await createTestUser({
      kullanici_adi: 'adminA', rol: 'site_yonetici', site_id: siteA.id,
    });
    adminB = await createTestUser({
      kullanici_adi: 'adminB', rol: 'site_yonetici', site_id: siteB.id,
    });
    guvenlikA = await createTestUser({
      kullanici_adi: 'gA', rol: 'guvenlik', site_id: siteA.id,
    });

    tokenSuper = makeToken({
      id: superAdmin.id, kullanici_adi: 'super', rol: 'superadmin', site_id: null,
    });
    tokenAdminA = makeToken({
      id: adminA.id, kullanici_adi: 'adminA', rol: 'site_yonetici', site_id: siteA.id,
    });
    tokenAdminB = makeToken({
      id: adminB.id, kullanici_adi: 'adminB', rol: 'site_yonetici', site_id: siteB.id,
    });
    tokenGuvenlikA = makeToken({
      id: guvenlikA.id, kullanici_adi: 'gA', rol: 'guvenlik', site_id: siteA.id,
    });

    // Her sitede birer daire + araç
    daireA1 = await createTestDaire({
      daire_no: 'A1', sahip_ad: 'Sahip A1', site_id: siteA.id,
    });
    daireB1 = await createTestDaire({
      daire_no: 'A1', sahip_ad: 'Sahip B1', site_id: siteB.id,
    });
    aracA1 = await createTestArac({
      daire_id: daireA1.id, plaka: '34A111', site_id: siteA.id,
    });
    aracB1 = await createTestArac({
      daire_id: daireB1.id, plaka: '34A111', site_id: siteB.id,  // Aynı plaka, farklı site OK
    });
  });

  afterAll(async () => {
    await cleanupTables();
    await db.destroy();
  });

  // ---------- DAIRE ENDPOINT'LERİ ----------

  describe('daireler izolasyon', () => {
    test('Site A user listeleme → sadece A daireleri', async () => {
      const r = await request(app)
        .get('/api/daireler')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(r.status).toBe(200);
      expect(r.body.daireler).toHaveLength(1);
      expect(r.body.daireler[0].id).toBe(daireA1.id);
    });

    test('Site B user listeleme → sadece B daireleri', async () => {
      const r = await request(app)
        .get('/api/daireler')
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(r.status).toBe(200);
      expect(r.body.daireler).toHaveLength(1);
      expect(r.body.daireler[0].id).toBe(daireB1.id);
    });

    test('Site A user, B dairesinin detayını isteyemez → 404', async () => {
      const r = await request(app)
        .get(`/api/daireler/${daireB1.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(r.status).toBe(404);
    });

    test('Site A admin, B dairesini güncellemeye çalışırsa → 404', async () => {
      const r = await request(app)
        .put(`/api/daireler/${daireB1.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ sahip_ad: 'Saldırgan' });
      expect(r.status).toBe(404);
      // Veri değişmediğini doğrula
      const fresh = await db('daireler').where({ id: daireB1.id }).first();
      expect(fresh.sahip_ad).toBe('Sahip B1');
    });

    test('Site A admin, B dairesini silmeye çalışırsa → 404', async () => {
      const r = await request(app)
        .delete(`/api/daireler/${daireB1.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(r.status).toBe(404);
      const fresh = await db('daireler').where({ id: daireB1.id }).first();
      expect(fresh.aktif).toBe(true);
    });

    test('Aynı daire_no farklı sitelerde olabilir (composite UNIQUE)', async () => {
      // Site B'ye A2 ekle, sonra Site A'ya da A2 ekle → ikincisi de 201 olmalı
      const rB = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          daire_no: 'B5', sahip_ad: 'B Sahip', sahip_tel: '05552220000',
          kvkk_riza: true,
        });
      expect(rB.status).toBe(201);

      const rA = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          daire_no: 'B5', sahip_ad: 'A Sahip', sahip_tel: '05551111111',
          kvkk_riza: true,
        });
      expect(rA.status).toBe(201);
      expect(rA.body.daire.site_id).toBe(siteA.id);
    });
  });

  // ---------- ARAC ENDPOINT'LERİ ----------

  describe('araclar izolasyon', () => {
    test('Site A user → sadece A araçları', async () => {
      const r = await request(app)
        .get('/api/araclar')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(r.status).toBe(200);
      const plates = r.body.araclar.map((a) => a.plaka);
      expect(plates).toContain('34A111');
      // Sadece 1 — B'nin de '34A111' var ama görmemeli
      expect(r.body.araclar).toHaveLength(1);
    });

    test('Site A admin, B aracını silemez', async () => {
      const r = await request(app)
        .delete(`/api/araclar/${aracB1.id}`)
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(r.status).toBe(404);
      const fresh = await db('araclar').where({ id: aracB1.id }).first();
      expect(fresh.aktif).toBe(true);
    });

    test('Aynı plaka farklı sitelerde olabilir (composite UNIQUE WHERE aktif)', async () => {
      const r = await request(app)
        .post('/api/araclar')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ daire_id: daireA1.id, plaka: '06XYZ999' });
      expect(r.status).toBe(201);

      const rB = await request(app)
        .post('/api/araclar')
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({ daire_id: daireB1.id, plaka: '06XYZ999' });
      expect(rB.status).toBe(201);
    });

    test('Site A admin, B dairesine araç ekleyemez (daire bulunamadı)', async () => {
      const r = await request(app)
        .post('/api/araclar')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ daire_id: daireB1.id, plaka: '07ABC000' });
      expect(r.status).toBe(404);
    });
  });

  // ---------- ROL TABANLI YETKİ ----------

  describe('rol bazlı yetki', () => {
    test('guvenlik kullanıcı daire ekleyemez → 403', async () => {
      const r = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenGuvenlikA}`)
        .send({
          daire_no: 'C9', sahip_ad: 'X', sahip_tel: '05551112222', kvkk_riza: true,
        });
      expect(r.status).toBe(403);
    });

    test('guvenlik kullanıcı daire listeleyebilir → 200', async () => {
      const r = await request(app)
        .get('/api/daireler')
        .set('Authorization', `Bearer ${tokenGuvenlikA}`);
      expect(r.status).toBe(200);
    });

    test('site_yonetici sites endpoint\'ine erişemez → 403', async () => {
      const r = await request(app)
        .get('/api/sites')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(r.status).toBe(403);
    });

    test('superadmin sites listesini alır → 200', async () => {
      const r = await request(app)
        .get('/api/sites')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.siteler)).toBe(true);
      const ids = r.body.siteler.map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining([siteA.id, siteB.id]));
    });
  });

  // ---------- SUPERADMIN SCOPE GEÇİŞİ ----------

  describe('superadmin scope geçişi', () => {
    test('superadmin ?siteId yoksa → 400 (zorunlu)', async () => {
      const r = await request(app)
        .get('/api/daireler')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(400);
    });

    test('superadmin ?siteId=A → A daireleri', async () => {
      const r = await request(app)
        .get(`/api/daireler?siteId=${siteA.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(200);
      expect(r.body.daireler.every((d) => d.site_id === siteA.id)).toBe(true);
    });

    test('superadmin ?siteId=B → B daireleri', async () => {
      const r = await request(app)
        .get(`/api/daireler?siteId=${siteB.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(200);
      expect(r.body.daireler.every((d) => d.site_id === siteB.id)).toBe(true);
    });
  });

  // ---------- SITES CRUD ----------

  describe('sites CRUD (superadmin only)', () => {
    test('superadmin yeni site oluşturur', async () => {
      const r = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ ad: 'Test C', slug: 'test-c', plan: 'standart' });
      expect(r.status).toBe(201);
      expect(r.body.site.slug).toBe('test-c');
    });

    test('aynı slug ile ikinci site → 409', async () => {
      const r = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ ad: 'Dup', slug: 'test-c', plan: 'baslangic' });
      expect(r.status).toBe(409);
    });

    test('default site (id=1) silinemez', async () => {
      const r = await request(app)
        .delete('/api/sites/1')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(400);
    });
  });
});
