const { hashPassword } = require('../../backend/src/utils/auth');

/**
 * Multi-tenant sonrası: BOOTSTRAP_ADMIN_USER/PASS → default site'nin
 * site_yonetici'si olarak insert edilir. Superadmin için ayrı seed
 * (02_bootstrap_superadmin.js) ve farklı env vars var.
 */
exports.seed = async function (knex) {
  const adminUser = process.env.BOOTSTRAP_ADMIN_USER || 'admin';
  const adminPass = process.env.BOOTSTRAP_ADMIN_PASS || 'ChangeMeOnFirstLogin!';

  const existing = await knex('users').where({ kullanici_adi: adminUser }).first();
  if (existing) {
    console.log(`[seed] Bootstrap admin '${adminUser}' zaten mevcut, atlanıyor.`);
    return;
  }

  // Default site (Ü1.1 migration'ı oluşturur — id=1)
  const defaultSite = await knex('sites').orderBy('id', 'asc').first();
  if (!defaultSite) {
    console.warn('[seed] Default site yok — Ü1.1 migration çalışmamış olabilir, bootstrap atlanıyor.');
    return;
  }

  const sifre_hash = await hashPassword(adminPass);
  await knex('users').insert({
    kullanici_adi: adminUser,
    sifre_hash,
    rol: 'site_yonetici',
    site_id: defaultSite.id,
    aktif: true,
  });
  console.log(`[seed] Bootstrap site_yonetici '${adminUser}' default site (${defaultSite.slug}) için oluşturuldu.`);
};
