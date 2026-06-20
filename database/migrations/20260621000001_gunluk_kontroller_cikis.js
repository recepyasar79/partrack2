/**
 * Araç giriş/çıkış logu (2026-06-21)
 *
 * Site yönetimi her aracın giriş-çıkış zamanını ve geriye dönük (≥2 ay) bir
 * log istedi. Mevcut modelde "çıkış" = satırı silmek; çıkış zamanı hiçbir
 * yerde kalmıyordu. Artık `gunluk_kontroller` satırı bir PARK OTURUMU:
 *   - giriş  = yukleme_zamani (mevcut kolon)
 *   - çıkış  = cikis_zamani (YENİ; NULL ise araç hâlâ içeride)
 *
 * "Çıkış Yap" butonu artık satırı silmek yerine cikis_zamani'ni damgalar.
 * "İçeride" = cikis_zamani IS NULL. Operasyon günü (08:00) filtresi board'u
 * sabah kendiliğinden sıfırlar; açık kalan geçmiş oturumlar ayrıca log için
 * mantıksal sabah-08:00 çıkışıyla kapatılır (job:gun-cikis).
 *
 * CUTOVER: mevcut tüm satırlar "kapanmış" işaretlenir (cikis_zamani =
 * yukleme_zamani) → deploy sonrası "içeride" listesi şişmez, board yeni
 * akşam yüklemeleriyle organik dolar.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('gunluk_kontroller', (t) => {
    t.timestamp('cikis_zamani', { useTz: true }).nullable();
  });
  // Açık oturum ("içeride") sorguları için kısmi index — çetele/analiz/sayaç
  // hep cikis_zamani IS NULL + site + operasyon günü ile filtreler.
  await knex.raw(
    `CREATE INDEX gk_acik_oturum_idx ON gunluk_kontroller(site_id, kontrol_tarihi) WHERE cikis_zamani IS NULL`
  );
  // Rapor (giriş/çıkış logu) tarih aralığı taraması için.
  await knex.raw(`CREATE INDEX gk_site_yukleme_idx ON gunluk_kontroller(site_id, yukleme_zamani)`);
  // Cutover: geçmiş tüm satırlar kapanmış sayılır.
  await knex('gunluk_kontroller').whereNull('cikis_zamani').update({
    cikis_zamani: knex.ref('yukleme_zamani'),
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS gk_acik_oturum_idx`);
  await knex.raw(`DROP INDEX IF EXISTS gk_site_yukleme_idx`);
  await knex.schema.alterTable('gunluk_kontroller', (t) => {
    t.dropColumn('cikis_zamani');
  });
};
