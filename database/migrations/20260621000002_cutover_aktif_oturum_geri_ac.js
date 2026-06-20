/**
 * Cutover düzeltmesi (2026-06-21)
 *
 * `20260621000001` cutover'ı mevcut TÜM satırları kapanmış işaretledi
 * (cikis_zamani = yukleme_zamani) — ama o an İÇERİDE olan (bu operasyon
 * gününe ait, henüz çıkmamış) araçlar da yanlışlıkla kapandı. Onlar hâlâ
 * içeride olmalı.
 *
 * Bu migration cutover'ın kapattığı ve hâlâ AKTİF operasyon gününe (08:00
 * sınırı) ait satırları yeniden açar (cikis_zamani = NULL). İmza:
 * cikis_zamani = yukleme_zamani (tam eşit) — gerçek "Çıkış Yap" (now()) ya
 * da otomatik 08:00 kapanışı bu imzaya uymadığından korunur. Geçmiş günlerin
 * satırları (kontrol_tarihi < operasyon günü) ETKİLENMEZ — onlar zaten gece
 * bitmiş sayılır.
 *
 * Tek seferlik veri düzeltmesi; yeni kurulan sitelerde mevcut satır olmadığı
 * için no-op. down boştur.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    UPDATE gunluk_kontroller
    SET cikis_zamani = NULL
    WHERE cikis_zamani IS NOT NULL
      AND cikis_zamani = yukleme_zamani
      AND kontrol_tarihi = (
        CASE
          WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/Istanbul')) < 8
            THEN (now() AT TIME ZONE 'Europe/Istanbul')::date - 1
          ELSE (now() AT TIME ZONE 'Europe/Istanbul')::date
        END
      )
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down() {
  // Tek seferlik veri düzeltmesi — geri alınmaz.
};
