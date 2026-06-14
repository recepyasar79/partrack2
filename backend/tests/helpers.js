const request = require('supertest');
const { hashPassword, signToken } = require('../src/utils/auth');
const db = require('../src/db');
const app = require('../src/server');
const userStatusCache = require('../src/utils/userStatusCache');

function makeToken(payload) {
  // Multi-tenant: middleware site_id'yi token'dan okur. Test'lerde her token
  // çağrısına site_id eklemek yerine burada default uyguluyoruz:
  // - superadmin: site_id null (platform-wide)
  // - site_yonetici/guvenlik: site_id 1 (default site)
  const site_id = payload.site_id !== undefined
    ? payload.site_id
    : (payload.rol === 'superadmin' ? null : 1);
  return signToken({ ...payload, site_id });
}

/**
 * Yeni test sitesi oluştur. ID alınır, slug unique.
 * Default site (id=1) Ü1.1 migration'ında otomatik var.
 */
async function createTestSite(overrides = {}) {
  const slug = overrides.slug || `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // blok_yapisi boş olursa daire_no validasyonu hep fail eder; default site
  // (id=1) migration'da A-D × 34 ile backfill ediliyor — test sitesi de aynı
  // varsayılan yapıya sahip olsun, override gerekirse override.blok_yapisi geç.
  const defaultBlokYapisi = ['A', 'B', 'C', 'D'].map((ad) => ({ ad, daire_sayisi: 34 }));
  const blokYapisi = overrides.blok_yapisi !== undefined ? overrides.blok_yapisi : defaultBlokYapisi;
  const [site] = await db('sites')
    .insert({
      ad: overrides.ad || 'Test Site',
      slug,
      plan: overrides.plan || 'baslangic',
      aktif: overrides.aktif !== undefined ? overrides.aktif : true,
      blok_yapisi: JSON.stringify(blokYapisi),
    })
    .returning('*');
  return site;
}

async function createTestUser(overrides = {}) {
  const hash = await hashPassword(overrides.sifre || 'TestPass123!');
  // Superadmin user'lar için site_id=NULL; aksi halde default site (id=1).
  const rol = overrides.rol || 'guvenlik';
  const site_id = overrides.site_id !== undefined
    ? overrides.site_id
    : (rol === 'superadmin' ? null : 1);
  // --forceExit ile yarıda kesilen bir koşu aynı kullanıcıyı bırakmış
  // olabilir; düz insert users_site_username_uniq'e takılıp TÜM suite'i
  // düşürüyordu (index partial olduğu için ON CONFLICT da kullanılamıyor).
  // Aynı isimli kalıntıyı FK bağımlılıklarıyla birlikte temizleyip ekle.
  const kullanici_adi = overrides.kullanici_adi || 'testuser';
  const eskiIds = await db('users').where({ kullanici_adi }).pluck('id');
  if (eskiIds.length) {
    await db('audit_log').whereIn('user_id', eskiIds).del();
    await db('misafir_araclar').whereIn('ekleyen_user_id', eskiIds).del();
    await db('gunluk_kontroller').whereIn('yukleyen_user_id', eskiIds).del();
    await db('report_schedules').whereIn('created_by_user_id', eskiIds).del();
    await db('users').whereIn('id', eskiIds).del();
  }
  const [user] = await db('users')
    .insert({
      kullanici_adi,
      sifre_hash: hash,
      rol,
      site_id,
      aktif: overrides.aktif !== undefined ? overrides.aktif : true,
    })
    .returning('*');
  return user;
}

async function createTestDaire(overrides = {}) {
  const daire_no = overrides.daire_no || 'A1';
  const blok = daire_no[0];
  const sira_no = parseInt(daire_no.slice(1), 10);
  const [daire] = await db('daireler')
    .insert({
      daire_no,
      blok,
      sira_no,
      sahip_ad: overrides.sahip_ad || 'Test Sahip',
      sahip_tel: overrides.sahip_tel || '05551234567',
      kvkk_riza: true,
      kvkk_riza_tarihi: db.fn.now(),
      bildirim_opt_in: overrides.bildirim_opt_in !== undefined ? overrides.bildirim_opt_in : true,
      aktif: true,
      site_id: overrides.site_id || 1,
    })
    .returning('*');
  return daire;
}

async function createTestArac(overrides = {}) {
  const [arac] = await db('araclar')
    .insert({
      daire_id: overrides.daire_id,
      plaka: overrides.plaka || '34ABC123',
      aktif: true,
      site_id: overrides.site_id || 1,
    })
    .returning('*');
  return arac;
}

async function cleanupTables(preserveUsers = []) {
  // authRequired kullanıcı durumunu kısa TTL cache'liyor; testler arası
  // (silinip yeniden oluşturulan kullanıcılarda) bayat durum sızmasın diye
  // cache'i sıfırla.
  userStatusCache._reset();
  // Child tables first (FK constraints)
  await db('bildirimler').del();
  await db('ihlaller').del();
  await db('misafir_araclar').del();
  await db('ocr_metrics').del();
  await db('gunluk_kontroller').del();
  await db('daire_sahip_tarihce').del();
  await db('audit_log').del();
  await db('plate_char_substitutions').del();
  await db('plate_learnings').del();
  await db('araclar').del();
  await db('daireler').del();
  // Only delete users not in preserve list
  if (preserveUsers.length > 0) {
    const ids = preserveUsers.map(u => u.id);
    await db('users').whereNotIn('id', ids).del();
  } else {
    await db('users').del();
  }
  // Sites: default site (id=1) hariç hepsini sil
  await db('sites').whereNot('id', 1).del();
  // Default site (id=1) baseline'a reset — başka testler PATCH ile slug/ad
  // değiştirmiş olabilir. Auth testleri 'varsayilan' slug bekliyor.
  const defaultBlokYapisi = ['A', 'B', 'C', 'D'].map((ad) => ({ ad, daire_sayisi: 34 }));
  await db('sites').where({ id: 1 }).update({
    ad: 'Varsayılan Site',
    slug: 'varsayilan',
    plan: 'baslangic',
    aktif: true,
    blok_yapisi: JSON.stringify(defaultBlokYapisi),
  });
}

module.exports = {
  app,
  request,
  db,
  makeToken,
  createTestSite,
  createTestUser,
  createTestDaire,
  createTestArac,
  cleanupTables,
};
