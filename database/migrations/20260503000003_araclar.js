exports.up = async function (knex) {
  await knex.schema.createTable('araclar', (t) => {
    t.increments('id').primary();
    t.integer('daire_id').notNullable().references('id').inTable('daireler').onDelete('CASCADE');
    t.string('plaka', 16).notNullable();
    t.boolean('aktif').notNullable().defaultTo(true);
    t.timestamp('kayit_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('silinme_zamani', { useTz: true }).nullable();
  });
  await knex.raw(`CREATE UNIQUE INDEX araclar_plaka_aktif_uniq ON araclar(plaka) WHERE aktif = true`);
  await knex.raw(`CREATE INDEX araclar_plaka_idx ON araclar(plaka)`);
  await knex.raw(`CREATE INDEX araclar_daire_id_idx ON araclar(daire_id)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('araclar');
};
