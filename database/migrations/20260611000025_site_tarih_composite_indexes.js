/**
 * Performans — site_id + kontrol_tarihi composite index'leri.
 *
 * Dashboard (/api/raporlar/dashboard), ihlal listesi (/api/kontroller/ihlaller)
 * ve günlük kontrol listesi (/api/kontroller) hep `site_id = ? AND
 * kontrol_tarihi BETWEEN/= ?` pattern'iyle sorguluyor. Mevcut index'ler tekil
 * (site_id ayrı, kontrol_tarihi ayrı) — Postgres bitmap-AND ile birleştirse de
 * veri büyüdükçe composite index tek index scan'le çok daha ucuz.
 *
 * Not: ihlaller'de kontrol_tarihi index'i hiç yoktu; gunluk_kontroller'de
 * tekil gk_kontrol_tarihi_idx vardı, o korunuyor (plaka aramaları için
 * gk_plaka_idx gibi hâlâ işe yarar).
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS ihlaller_site_tarih_idx ON ihlaller(site_id, kontrol_tarihi)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS gk_site_tarih_idx ON gunluk_kontroller(site_id, kontrol_tarihi)'
  );
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS gk_site_tarih_idx');
  await knex.raw('DROP INDEX IF EXISTS ihlaller_site_tarih_idx');
};
