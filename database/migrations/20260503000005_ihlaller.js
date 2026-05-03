exports.up = async function (knex) {
  await knex.schema.createTable('ihlaller', (t) => {
    t.increments('id').primary();
    t.date('kontrol_tarihi').notNullable();
    t.integer('daire_id').nullable().references('id').inTable('daireler').onDelete('SET NULL');
    t.string('daire_no_snapshot', 4).nullable();
    t.jsonb('plaka_listesi').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
    t.string('ihlal_tipi', 32).notNullable();
    t.timestamp('olusturma_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE ihlaller ADD CONSTRAINT ihlaller_tip_chk CHECK (ihlal_tipi IN ('coklu_arac','kayitsiz'))`);
  await knex.raw(`CREATE UNIQUE INDEX ihlaller_uniq_daire_gun ON ihlaller(kontrol_tarihi, daire_id) WHERE daire_id IS NOT NULL`);
  await knex.raw(`CREATE INDEX ihlaller_kontrol_tarihi_idx ON ihlaller(kontrol_tarihi)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ihlaller');
};
