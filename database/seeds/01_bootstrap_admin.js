const { hashPassword } = require('../../backend/src/utils/auth');

/**
 * Multi-tenant sonrası: BOOTSTRAP_ADMIN_USER/PASS → default site'nin
 * site_yonetici'si olarak insert edilir. Superadmin için ayrı seed
 * (02_bootstrap_superadmin.js) ve farklı env vars var.
 */
exports.seed = async function (knex) {
  const adminUser = process.env.BOOTSTRAP_ADMIN_USER;
  const adminPass = process.env.BOOTSTRAP_ADMIN_PASS;

  // GÜVENLİK: varsayılan kimlik bilgisi YOK. Env set değilse seed atlanır.
  // Aksi halde fresh prod'da bilinen `admin` / sabit şifreli bir site_yonetici
  // oluşur; default site slug'ı da sabit olduğundan login yüzeyi tamamen
  // tahmin edilebilir hale gelir (02_bootstrap_superadmin ile aynı kalıp).
  if (!adminUser || !adminPass) {
    console.log('[seed] BOOTSTRAP_ADMIN_USER/PASS set değil, bootstrap admin seed atlanıyor.');
    return;
  }
  if (adminPass.length < 10) {
    console.warn('[seed] BOOTSTRAP_ADMIN_PASS çok kısa (<10 karakter), bootstrap admin seed atlanıyor.');
    return;
  }

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
