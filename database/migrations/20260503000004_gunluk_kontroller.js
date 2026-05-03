exports.up = async function (knex) {
  await knex.schema.createTable('gunluk_kontroller', (t) => {
    t.increments('id').primary();
    t.date('kontrol_tarihi').notNullable();
    t.string('plaka', 16).notNullable();
    t.string('foto_url', 500).nullable();
    t.integer('yukleyen_user_id').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('yukleme_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE INDEX gk_kontrol_tarihi_idx ON gunluk_kontroller(kontrol_tarihi)`);
  await knex.raw(`CREATE INDEX gk_plaka_idx ON gunluk_kontroller(plaka)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('gunluk_kontroller');
};
