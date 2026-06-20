// Her site için toplam park (otopark) kapasitesi — sitede fiziksel olarak kaç
// araç park edebilir. Superadmin site tanımlarken / sonradan PATCH ile set eder.
// Header'da "Park Yeri Sayısı / İçerideki Araç Sayısı" kutucuğunda gösterilir.
// 0 = tanımsız (gösterimde "—"). Aktif müşteri (site id=1) için 138 backfill.
exports.up = async function up(knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.integer('park_kapasitesi').notNullable().defaultTo(0);
  });
  await knex('sites').where({ id: 1 }).update({ park_kapasitesi: 138 });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.dropColumn('park_kapasitesi');
  });
};
