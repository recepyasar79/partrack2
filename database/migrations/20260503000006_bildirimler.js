exports.up = async function (knex) {
  await knex.schema.createTable('bildirimler', (t) => {
    t.increments('id').primary();
    t.integer('ihlal_id').notNullable().references('id').inTable('ihlaller').onDelete('CASCADE');
    t.string('daire_no', 4).notNullable();
    t.string('telefon', 20).notNullable();
    t.text('mesaj').notNullable();
    t.string('gonderim_durumu', 16).notNullable().defaultTo('beklemede');
    t.integer('deneme_sayisi').notNullable().defaultTo(0);
    t.timestamp('gonderim_zamani', { useTz: true }).nullable();
    t.text('hata_mesaji').nullable();
    t.timestamp('olusturma_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE bildirimler ADD CONSTRAINT bildirimler_durum_chk CHECK (gonderim_durumu IN ('beklemede','gonderildi','basarisiz'))`);
  await knex.raw(`CREATE INDEX bildirimler_durum_idx ON bildirimler(gonderim_durumu)`);
  await knex.raw(`CREATE INDEX bildirimler_ihlal_idx ON bildirimler(ihlal_id)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bildirimler');
};
