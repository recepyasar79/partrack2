/**
 * gece_cetelesi.manuel — bir dairenin sayacı güvenlik görevlisi tarafından
 * elle (+/-) değiştirildi mi? GET tohumlaması manuel OLMAYAN satırları her
 * açılışta güncel akşam tespitine yeniler (geç yükleme / bayat tohum yansısın);
 * manuel=true satırlara dokunmaz (gece boyu yapılan sayım korunur). PATCH her
 * çağrıda manuel=true yapar. yenile=1 hepsini tespite sıfırlar (manuel=false).
 *
 * Saha 2026-06-16: ilk açılışta kırmızı (2 araç) daireler görünmüyordu çünkü
 * önceden tohumlanmış bayat satırlar GET'te güncellenmiyordu.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('gece_cetelesi', (t) => {
    t.boolean('manuel').notNullable().defaultTo(false);
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('gece_cetelesi', (t) => {
    t.dropColumn('manuel');
  });
};
