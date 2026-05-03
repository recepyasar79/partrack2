exports.up = async function (knex) {
  await knex.schema.createTable('daire_sahip_tarihce', (t) => {
    t.increments('id').primary();
    t.integer('daire_id').notNullable().references('id').inTable('daireler').onDelete('CASCADE');
    t.string('sahip_ad', 120).notNullable();
    t.string('sahip_tel', 20).notNullable();
    t.timestamp('baslangic_tarihi', { useTz: true }).notNullable();
    t.timestamp('bitis_tarihi', { useTz: true }).nullable();
    t.timestamp('olusturma_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE INDEX dst_daire_idx ON daire_sahip_tarihce(daire_id)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('daire_sahip_tarihce');
};
