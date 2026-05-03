exports.up = async function (knex) {
  await knex.schema.createTable('audit_log', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.string('eylem', 32).notNullable();
    t.string('tablo_adi', 64).notNullable();
    t.integer('kayit_id').nullable();
    t.jsonb('eski_deger').nullable();
    t.jsonb('yeni_deger').nullable();
    t.string('ip_adres', 64).nullable();
    t.timestamp('zaman', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE INDEX audit_user_idx ON audit_log(user_id)`);
  await knex.raw(`CREATE INDEX audit_tablo_kayit_idx ON audit_log(tablo_adi, kayit_id)`);
  await knex.raw(`CREATE INDEX audit_zaman_idx ON audit_log(zaman)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_log');
};
