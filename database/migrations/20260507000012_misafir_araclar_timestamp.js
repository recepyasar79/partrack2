exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE misafir_araclar DROP CONSTRAINT IF EXISTS mis_tarih_chk`);
  await knex.schema.alterTable('misafir_araclar', (t) => {
    t.timestamp('baslangic_tarihi', { useTz: true }).notNullable().alter();
    t.timestamp('bitis_tarihi', { useTz: true }).notNullable().alter();
  });
  await knex.raw(
    `ALTER TABLE misafir_araclar ADD CONSTRAINT mis_tarih_chk CHECK (bitis_tarihi >= baslangic_tarihi)`,
  );
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE misafir_araclar DROP CONSTRAINT IF EXISTS mis_tarih_chk`);
  await knex.schema.alterTable('misafir_araclar', (t) => {
    t.date('baslangic_tarihi').notNullable().alter();
    t.date('bitis_tarihi').notNullable().alter();
  });
  await knex.raw(
    `ALTER TABLE misafir_araclar ADD CONSTRAINT mis_tarih_chk CHECK (bitis_tarihi >= baslangic_tarihi)`,
  );
};
