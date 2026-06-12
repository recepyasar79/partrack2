/**
 * 20260524000019 migration'ı daireler CHECK'lerini gevşetmek istemişti ama
 * yanlış constraint adlarını drop etti: gerçek adlar `daireler_sira_chk` ve
 * `daireler_blok_chk` (20260503000002'de raw SQL ile eklendi), drop edilenler
 * `daireler_sira_no_check` ve `daireler_blok_check`. Sonuç: sira_no hâlâ 1-34,
 * blok hâlâ A-D ile sınırlıydı — blok başına 34+ daireli siteler (örn.
 * Taşdelen Akasya Evleri 4×36) veya farklı blok adlı siteler daire ekleyemiyordu.
 *
 * İki kısıtı da kaldırıyoruz — blok adları ve blok başına daire sayısı zaten
 * site bazında sites.blok_yapisi üzerinden uygulama katmanında doğrulanıyor
 * (utils/siteYapisi.js isValidDaireInSite). DB'de sadece pozitiflik kalsın.
 *
 * NOT: Production'a 2026-06-12'de raw SQL ile elden uygulandı (knex_migrations
 * kaydı yok — boot'taki migrate:latest image'da olmayan dosyada çöküyor).
 * DROP IF EXISTS sayesinde bu migration'ın prod'da tekrar çalışması güvenli.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_sira_chk');
  await knex.raw('ALTER TABLE daireler ADD CONSTRAINT daireler_sira_chk CHECK (sira_no >= 1)');
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_blok_chk');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_sira_chk');
  // Orijinal sınırlar — A-D dışı blok veya 34 üstü sira_no kaydı varsa bu
  // down migration başarısız olur.
  await knex.raw('ALTER TABLE daireler ADD CONSTRAINT daireler_sira_chk CHECK (sira_no BETWEEN 1 AND 34)');
  await knex.raw("ALTER TABLE daireler ADD CONSTRAINT daireler_blok_chk CHECK (blok IN ('A','B','C','D'))");
};
