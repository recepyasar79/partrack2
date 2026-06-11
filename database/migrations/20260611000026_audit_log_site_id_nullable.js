/**
 * Güvenlik — platform-seviyesi (superadmin) işlemler de audit'lensin.
 *
 * audit_log.site_id NOT NULL idi → site bağlamı olmayan olaylar (örn. site
 * hard-delete: sitenin kendi audit satırları da aynı transaction'da silinir)
 * DB'ye hiç yazılamıyor, yalnız console.warn'da kalıyordu. NOT NULL kalkar;
 * site_id NULL = platform katmanı olayı. Site yöneticisi listesi zaten
 * site_id = kendi site'si ile filtreliyor, NULL satırlar onlara sızmaz.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE audit_log ALTER COLUMN site_id DROP NOT NULL');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  // NULL satırlar NOT NULL'a geri dönüşü engeller — platform olaylarını sil.
  await knex('audit_log').whereNull('site_id').del();
  await knex.raw('ALTER TABLE audit_log ALTER COLUMN site_id SET NOT NULL');
};
