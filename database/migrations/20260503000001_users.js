exports.up = async function (knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('kullanici_adi', 64).notNullable().unique();
    t.string('sifre_hash', 255).notNullable();
    t.enu('rol', ['yonetici', 'guvenlik'], {
      useNative: false,
      existingType: false,
    }).notNullable();
    t.boolean('aktif').notNullable().defaultTo(true);
    t.timestamp('son_giris', { useTz: true }).nullable();
    t.timestamp('olusturma_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('users');
};
