exports.up = async function (knex) {
  await knex.schema.createTable('misafir_araclar', (t) => {
    t.increments('id').primary();
    t.integer('daire_id').notNullable().references('id').inTable('daireler').onDelete('CASCADE');
    t.string('plaka', 16).notNullable();
    t.date('baslangic_tarihi').notNullable();
    t.date('bitis_tarihi').notNullable();
    t.string('aciklama', 255).nullable();
    t.integer('ekleyen_user_id').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('olusturma_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE misafir_araclar ADD CONSTRAINT mis_tarih_chk CHECK (bitis_tarihi >= baslangic_tarihi)`);
  await knex.raw(`CREATE INDEX mis_plaka_idx ON misafir_araclar(plaka)`);
  await knex.raw(`CREATE INDEX mis_tarih_idx ON misafir_araclar(baslangic_tarihi, bitis_tarihi)`);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('misafir_araclar');
};
