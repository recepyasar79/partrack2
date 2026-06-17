/**
 * 2. Araç Park Hakkı (2026-06-17)
 *
 * İş kuralı: Normalde her daireden gece yalnız 1 araç konaklayabilir. Bu
 * özellikle bazı daireler — site bazında belirlenen bir KOTA dahilinde —
 * ikinci araca da izinli işaretlenebilir. İzinli daire 2 araca kadar ihlal
 * SAYILMAZ; 3+ araçta yine akşam kontrolüne düşer.
 *
 * İki kolon:
 *   - daireler.ikinci_arac_izinli BOOL  → daire bu hakka sahip mi
 *   - sites.ikinci_arac_kapasitesi INT  → site genelinde kaç daireye bu hak
 *     verilebilir (kota). Aşılırsa daire kaydı/güncellemesi reddedilir.
 *
 * Backfill: aktif müşteri (site id=1) kapasitesi 10 olarak set edilir.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('daireler', (t) => {
    t.boolean('ikinci_arac_izinli').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('sites', (t) => {
    t.integer('ikinci_arac_kapasitesi').notNullable().defaultTo(0);
  });
  // Aktif müşteri (default site) için kota 10.
  await knex('sites').where({ id: 1 }).update({ ikinci_arac_kapasitesi: 10 });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('daireler', (t) => {
    t.dropColumn('ikinci_arac_izinli');
  });
  await knex.schema.alterTable('sites', (t) => {
    t.dropColumn('ikinci_arac_kapasitesi');
  });
};
