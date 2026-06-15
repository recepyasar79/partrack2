/**
 * gece_cetelesi — Akşam kontrolü sonrası "Gece Çetelesi" ekranının canlı
 * sayacı. Her (site, daire, tarih) için o an içeride olan araç sayısını tutar.
 *
 * Akış: ekran ilk açıldığında akşam tespitinden (gunluk_kontroller → daire
 * eşlemesi) tohumlanır; sonrası tamamen manueldir — güvenlik görevlisi araç
 * giriş/çıkışında daire butonundan +/- ile sayacı günceller. Renk sayıya göre:
 * 0 pasif, 1 sarı, 2 kırmızı, 3+ koyu kırmızı.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('gece_cetelesi', (t) => {
    t.increments('id').primary();
    t.bigInteger('site_id').notNullable().references('id').inTable('sites');
    t.integer('daire_id').notNullable().references('id').inTable('daireler').onDelete('CASCADE');
    t.date('tarih').notNullable();
    t.integer('arac_sayisi').notNullable().defaultTo(0);
    t.timestamp('guncelleme_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE UNIQUE INDEX gece_cetelesi_uniq ON gece_cetelesi(site_id, daire_id, tarih)');
  await knex.raw('CREATE INDEX gece_cetelesi_site_tarih_idx ON gece_cetelesi(site_id, tarih)');
  await knex.raw('ALTER TABLE gece_cetelesi ADD CONSTRAINT gece_cetelesi_sayi_chk CHECK (arac_sayisi >= 0)');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('gece_cetelesi');
};
