/**
 * Multi-tenant Faz Ü1.11 — users.kullanici_adi unique constraint'ini
 * site-içi unique'e çevir.
 *
 * Önce:  UNIQUE(kullanici_adi) globaldi → 10 müşteri "ahmet" çakışırdı.
 * Sonra:
 *   - UNIQUE(site_id, kullanici_adi) WHERE site_id IS NOT NULL
 *     (site-bağlı user'lar için, site içinde unique)
 *   - UNIQUE(kullanici_adi) WHERE site_id IS NULL
 *     (superadmin'lar için, site_id NULL grubunda unique)
 *
 * NOT: partial unique index'ler PostgreSQL-spesifik. pg-mem'de
 * çalışmayabilir ama production'da sorunsuz.
 *
 * Geriye uyumluluk: mevcut user'ların kullanici_adi'sı zaten global unique
 * olduğu için backfill gerekmez — yeni constraint anında satışı.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  // Knex .unique() ile yaratılan eski constraint adı: users_kullanici_adi_unique
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kullanici_adi_unique');
  // Bazı PostgreSQL sürümleri farklı isim verebilir; ek olarak deneyelim
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kullanici_adi_key');

  // Site-bağlı user'lar için: aynı site_id altında kullanici_adi unique
  await knex.raw(`
    CREATE UNIQUE INDEX users_site_username_uniq
    ON users(site_id, kullanici_adi)
    WHERE site_id IS NOT NULL
  `);

  // Superadmin'lar için: site_id NULL grubunda kullanici_adi unique
  await knex.raw(`
    CREATE UNIQUE INDEX users_superadmin_username_uniq
    ON users(kullanici_adi)
    WHERE site_id IS NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS users_superadmin_username_uniq');
  await knex.raw('DROP INDEX IF EXISTS users_site_username_uniq');
  await knex.raw('ALTER TABLE users ADD CONSTRAINT users_kullanici_adi_unique UNIQUE (kullanici_adi)');
};
