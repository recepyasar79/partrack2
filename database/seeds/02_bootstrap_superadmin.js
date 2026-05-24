const { hashPassword } = require('../../backend/src/utils/auth');

/**
 * Multi-tenant superadmin (platform sahibi) bootstrap seed.
 *
 * BOOTSTRAP_SUPERADMIN_USER/PASS env vars set ise ve henüz superadmin
 * yoksa oluşturulur. site_id NULL — superadmin bir site'ye bağlı
 * değildir, tüm tenant'lara erişir.
 *
 * Production'da bu env'ler set edilip ilk deploy sonra unset edilmeli
 * (veya rotate). Aynı kullanıcı adı zaten varsa idempotent atlar.
 */
exports.seed = async function (knex) {
  const user = process.env.BOOTSTRAP_SUPERADMIN_USER;
  const pass = process.env.BOOTSTRAP_SUPERADMIN_PASS;

  if (!user || !pass) {
    console.log('[seed] BOOTSTRAP_SUPERADMIN_USER/PASS set değil, superadmin seed atlanıyor.');
    return;
  }

  const existing = await knex('users').where({ kullanici_adi: user }).first();
  if (existing) {
    if (existing.rol !== 'superadmin') {
      console.warn(`[seed] '${user}' kullanıcısı var ama rolü '${existing.rol}'. Superadmin'e yükseltmek için manuel müdahale gerekir.`);
    } else {
      console.log(`[seed] Superadmin '${user}' zaten mevcut, atlanıyor.`);
    }
    return;
  }

  const sifre_hash = await hashPassword(pass);
  await knex('users').insert({
    kullanici_adi: user,
    sifre_hash,
    rol: 'superadmin',
    site_id: null,
    aktif: true,
  });
  console.log(`[seed] Superadmin '${user}' oluşturuldu.`);
};
