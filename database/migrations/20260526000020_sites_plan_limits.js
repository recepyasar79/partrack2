/**
 * Faz Ü2.1 — sites.plan_limits JSONB kolonu.
 *
 * Her site için plan-bazlı limit override'ı saklar. NULL veya '{}' ise
 * planLimits.js'deki DEFAULTS kullanılır. Override sadece superadmin
 * tarafından özel müşteri pazarlığı için ayarlanır (örn. baslangic
 * planında 80 daire izni).
 *
 * Yapı:
 *   { "daire_max": 200, "user_max": 25 }
 *
 * Eksik anahtarlar (örn. sadece daire_max override) DEFAULTS'tan
 * tamamlanır. null değer = sınırsız (kurumsal davranışı).
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.jsonb('plan_limits').nullable().comment(
      'Plan-bazlı limit override. NULL → planLimits.js DEFAULTS kullanılır.'
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.dropColumn('plan_limits');
  });
};
