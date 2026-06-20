// Her site (müşteri) kendi WhatsApp bildirim numaralarını tanımlar (en fazla 5).
// Günün ihlal özeti bu numaralara (yönetim/güvenlik) tek mesajda gönderilir.
// jsonb dizi: ["05XXXXXXXXX", ...]. Site-bazlı izolasyon: her müşteri ayrı.
exports.up = async function (knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.jsonb('bildirim_telefonlari').notNullable().defaultTo('[]');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.dropColumn('bildirim_telefonlari');
  });
};
