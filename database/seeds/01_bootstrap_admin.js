const { hashPassword } = require('../../backend/src/utils/auth');

exports.seed = async function (knex) {
  const adminUser = process.env.BOOTSTRAP_ADMIN_USER || 'admin';
  const adminPass = process.env.BOOTSTRAP_ADMIN_PASS || 'ChangeMeOnFirstLogin!';

  const existing = await knex('users').where({ kullanici_adi: adminUser }).first();
  if (existing) {
    console.log(`[seed] Bootstrap admin '${adminUser}' zaten mevcut, atlanıyor.`);
    return;
  }

  const sifre_hash = await hashPassword(adminPass);
  await knex('users').insert({
    kullanici_adi: adminUser,
    sifre_hash,
    rol: 'yonetici',
    aktif: true,
  });
  console.log(`[seed] Bootstrap admin '${adminUser}' oluşturuldu.`);
};
