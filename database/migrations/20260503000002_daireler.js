exports.up = async function (knex) {
  await knex.schema.createTable('daireler', (t) => {
    t.increments('id').primary();
    t.string('daire_no', 4).notNullable().unique();
    t.specificType('blok', 'char(1)').notNullable();
    t.integer('sira_no').notNullable();
    t.string('sahip_ad', 120).notNullable();
    t.string('sahip_tel', 20).notNullable();
    t.boolean('kvkk_riza').notNullable().defaultTo(false);
    t.timestamp('kvkk_riza_tarihi', { useTz: true }).nullable();
    t.boolean('bildirim_opt_in').notNullable().defaultTo(false);
    t.boolean('aktif').notNullable().defaultTo(true);
    t.timestamp('kayit_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('silinme_zamani', { useTz: true }).nullable();
  });
  await knex.raw(`ALTER TABLE daireler ADD CONSTRAINT daireler_blok_chk CHECK (blok IN ('A','B','C','D'))`);
  await knex.raw(`ALTER TABLE daireler ADD CONSTRAINT daireler_sira_chk CHECK (sira_no BETWEEN 1 AND 34)`);
  await knex.raw(`CREATE INDEX daireler_daire_no_idx ON daireler(daire_no)`);
  await knex.raw(`CREATE INDEX daireler_aktif_idx ON daireler(aktif) WHERE aktif = true`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('daireler');
};
