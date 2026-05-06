/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // araclar tablosuna renk ve marka ekle
  await knex.schema.table('araclar', (t) => {
    t.string('renk', 20).nullable().comment('Araç rengi');
    t.string('marka', 30).nullable().comment('Araç markası');
  });

  // gunluk_kontroller tablosuna da ekle (foto anında tespit edilen özellikler)
  await knex.schema.table('gunluk_kontroller', (t) => {
    t.string('renk', 20).nullable().comment('Fotoğraftan tespit edilen renk');
    t.string('marka', 30).nullable().comment('Fotoğraftan tespit edilen marka');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.table('gunluk_kontroller', (t) => {
    t.dropColumn('marka');
    t.dropColumn('renk');
  });
  await knex.schema.table('araclar', (t) => {
    t.dropColumn('marka');
    t.dropColumn('renk');
  });
};
