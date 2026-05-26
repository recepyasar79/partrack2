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

  // ---------- SUPERADMIN PLATFORM İZOLASYONU ----------
  //
  // Superadmin müşteri sitelerinin domain verisine (daire/araç/foto/sahip)
  // erişemez — platform katmanı izolasyonu, KVKK + müşteri güveni için.
  // Yalnız /sites/* endpoint'leri (platform işleri) açıktır.

  describe('superadmin platform izolasyonu', () => {
    test('superadmin /daireler → 403 (domain verisi yasak)', async () => {
      const r = await request(app)
        .get('/api/daireler')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(403);
    });

    test('superadmin ?siteId=A bile olsa /daireler → 403', async () => {
      const r = await request(app)
        .get(`/api/daireler?siteId=${siteA.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(403);
    });

    test('superadmin /araclar → 403', async () => {
      const r = await request(app)
        .get('/api/araclar')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(403);
    });

    test('superadmin /kontroller → 403', async () => {
      const r = await request(app)
        .get('/api/kontroller')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(403);
    });
  });

  // ---------- SITES CRUD ----------

  describe('sites CRUD (superadmin only)', () => {
    test('superadmin yeni site oluşturur (slug otomatik üretilir, body slug yok sayılır)', async () => {
      const r = await request(app)
        .post('/api/sites')
        .set('Authorization', `Bearer ${tokenSuper}`)
        // Body'de slug versek bile YOK SAYILIR — Ü1.11'de güvenlik için
        // tahmin edilemez 10 karakterlik slug otomatik üretiliyor.
        .send({ ad: 'Test C', slug: 'tahmin-edilebilir', plan: 'standart' });
      expect(r.status).toBe(201);
      expect(r.body.site.slug).not.toBe('tahmin-edilebilir');
      expect(r.body.site.slug).toMatch(/^[a-z0-9]{10}$/);
    });

    test('PATCH ile slug çakışması → 409', async () => {
      // Manuel slug değişimi (yalnız superadmin için açık) çakışma kontrolü
      // hâlâ aktif: B sitesinin slug'ı zaten 'site-b'; başka bir siteyi de
      // bu slug'a almaya çalış → 409.
      const yeniSite = await db('sites')
        .insert({ ad: 'Çakışma Test', slug: 'cakisma-test', plan: 'baslangic', aktif: true })
        .returning('*');
      const r = await request(app)
        .patch(`/api/sites/${yeniSite[0].id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ slug: 'site-b' });
      expect(r.status).toBe(409);
    });

    test('default site (id=1) silinemez', async () => {
      const r = await request(app)
        .delete('/api/sites/1')
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(400);
    });
  });

  // ---------- AUDIT LOG: superadmin işlemleri site_yonetici'ye gizli ----------
  //
  // Site yöneticisi GET /api/audit-log çağırınca, kendi site_id'sindeki tüm
  // kayıtları DEĞİL — superadmin (platform sahibi) tarafından yapılan işlemler
  // hariç görür. Slug değişimi, kullanıcı oluşturma vs. site sahibine değil
  // platforma ait detaylardır. Silinmiş user (NULL user_id) satırları
  // tarihsel kayıt olarak korunur.

  describe('audit log: superadmin işlemleri gizli', () => {
    test('superadmin slug değişimi adminA listesinde GÖRÜNMEZ', async () => {
      const rPatch = await request(app)
        .patch(`/api/sites/${siteA.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ slug: `gizli-${Date.now().toString(36)}` });
      expect(rPatch.status).toBe(200);

      const rLog = await request(app)
        .get('/api/audit-log?tablo=sites')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(rLog.status).toBe(200);
      const superAction = rLog.body.kayitlar.find(
        (k) => k.eylem === 'guncelle' && k.tablo_adi === 'sites' && k.kayit_id === siteA.id
      );
      expect(superAction).toBeUndefined();
    });

    test('adminA kendi yaptığı işlemi audit_log\'da görür', async () => {
      const rPost = await request(app)
        .post('/api/daireler')
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          daire_no: 'D9', sahip_ad: 'Audit Test', sahip_tel: '05553334444',
          kvkk_riza: true,
        });
      expect(rPost.status).toBe(201);

      const rLog = await request(app)
        .get('/api/audit-log?tablo=daireler')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(rLog.status).toBe(200);
      const benimKayit = rLog.body.kayitlar.find(
        (k) => k.kayit_id === rPost.body.daire.id && k.eylem === 'olustur'
      );
      expect(benimKayit).toBeDefined();
      expect(benimKayit.kullanici_adi).toBe('adminA');
    });

    test('NULL user_id\'li satır (silinmiş kullanıcı) listede görünür', async () => {
      // Direkt DB'ye user_id=null insert et — bir kullanıcının silindiği durumu
      // simüle ediyor (users FK SET NULL).
      await db('audit_log').insert({
        user_id: null,
        site_id: siteA.id,
        eylem: 'eski-kayit',
        tablo_adi: 'daireler',
        kayit_id: 999999,
        ip_adres: '127.0.0.1',
      });

      const rLog = await request(app)
        .get('/api/audit-log')
        .set('Authorization', `Bearer ${tokenAdminA}`);
      expect(rLog.status).toBe(200);
      const silinmis = rLog.body.kayitlar.find((k) => k.eylem === 'eski-kayit');
      expect(silinmis).toBeDefined();
      expect(silinmis.kullanici_adi).toBeNull();
    });
  });

  // ---------- SITE HARD DELETE CASCADE ----------
  //
  // DELETE /api/sites/:id tek transaction içinde 13 tabloyu temizler.
  // Burada ayrı bir test sitesi (C) oluşturup içine domain verisi yazıyoruz;
  // silme sonrası: (a) C'nin tüm satırları gitti, (b) A/B sitelerinin verisi
  // sağlam, (c) id=1 her durumda korunuyor.

  describe('site hard delete cascade', () => {
    test('site silme 13 tablodaki kayıtları temizler, diğer site etkilenmez', async () => {
      // Test sitesi C + domain verisi
      const siteC = await createTestSite({ ad: 'Cascade Test', slug: 'cascade-test' });
      const daireC = await createTestDaire({
        daire_no: 'C1', sahip_ad: 'Cascade Sahip', site_id: siteC.id,
      });
      const aracC = await createTestArac({
        daire_id: daireC.id, plaka: '99CCC999', site_id: siteC.id,
      });
      await db('audit_log').insert({
        site_id: siteC.id, user_id: superAdmin.id,
        eylem: 'olustur', tablo_adi: 'sites', kayit_id: siteC.id,
        ip_adres: '127.0.0.1',
      });
      await db('gunluk_kontroller').insert({
        site_id: siteC.id, plaka: '99CCC999',
        kontrol_tarihi: new Date().toISOString().slice(0, 10),
      });

      // A sitesinde de referans veri olduğunu doğrula (silinmesin)
      const aOnceDaire = await db('daireler').where({ site_id: siteA.id }).count('* as c').first();

      const r = await request(app)
        .delete(`/api/sites/${siteC.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`);
      expect(r.status).toBe(200);

      // C'nin hiçbir tablodaki kaydı kalmamalı
      const tablolar = [
        'sites', 'daireler', 'araclar', 'gunluk_kontroller',
        'audit_log', 'misafir_araclar', 'daire_sahip_tarihce',
        'ihlaller', 'bildirimler', 'ocr_metrics',
        'plate_learnings', 'plate_char_substitutions',
      ];
      for (const t of tablolar) {
        const col = t === 'sites' ? 'id' : 'site_id';
        const sayi = await db(t).where(col, siteC.id).count('* as c').first();
        expect(parseInt(sayi.c, 10)).toBe(0);
      }
      // users tablosunda da C'ye bağlı kalmamalı (siteC'nin user'ı yoktu zaten)
      const userC = await db('users').where({ site_id: siteC.id }).count('* as c').first();
      expect(parseInt(userC.c, 10)).toBe(0);

      // A sitesinin daire sayısı değişmemiş olmalı
      const aSonDaire = await db('daireler').where({ site_id: siteA.id }).count('* as c').first();
      expect(aSonDaire.c).toBe(aOnceDaire.c);

      // Kullanılmamış değişkenler uyarı vermesin (referans)
      expect(daireC.id).toBeDefined();
      expect(aracC.id).toBeDefined();
    });
  });
});
