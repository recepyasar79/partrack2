/**
 * coklu_arac ihlal kaydina misafir plaka alt-listesi eklenir. Raporlarda
 * "Misafir Araç" kutusunu ayri gostermek ve "Çoklu Araç" (fazla) sayisindan
 * misafirleri dusmek icin gerekli — plaka_listesi misafir + kayitli karisik
 * tutuyor, hangilerinin misafir oldugu bilinmiyordu.
 *
 * Gecmis kayitlar default '[]' alir (geriye donuk misafir kirilimi yok);
 * ileri tarihli analiz-et cagrilarinda dolar.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('ihlaller', (t) => {
    t.jsonb('misafir_plaka_listesi').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('ihlaller', (t) => {
    t.dropColumn('misafir_plaka_listesi');
  });
};
