/**
 * Multi-tenant Faz Ü1.11 — sites.blok_yapisi JSONB kolonu.
 *
 * Her site'nin blok/daire yapısı esnek olur:
 *   [{ "ad": "A", "daire_sayisi": 34 }, { "ad": "B", "daire_sayisi": 34 }, ...]
 *
 * Mevcut hardcoded varsayım (A/B/C/D × 34) artık zorunlu değil. Default
 * site (id=1) için backfill: 4 blok × 34 daire (eski yapıyı koruyor).
 *
 * Yeni siteler bu kolona göre validate edilir (utils/siteYapisi.js).
 *
 * NOT: daireler tablosundaki blok CHAR(1) ve sira_no CHECK 1-34
 * şartlarını da gevşetiyoruz. Yeni siteler farklı blok adı (örn. "Bahçe")
 * veya daha fazla daire sayısı (örn. 50) kullanabilsin diye.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('sites', (t) => {
    t.jsonb('blok_yapisi').notNullable().defaultTo(JSON.stringify([]));
  });

  // Default site (id=1) backfill: A/B/C/D × 34 (eski yapı)
  const defaultBlokYapisi = [
    { ad: 'A', daire_sayisi: 34 },
    { ad: 'B', daire_sayisi: 34 },
    { ad: 'C', daire_sayisi: 34 },
    { ad: 'D', daire_sayisi: 34 },
  ];
  await knex('sites')
    .where({ id: 1 })
    .update({ blok_yapisi: JSON.stringify(defaultBlokYapisi) });

  // daireler.blok ve sira_no CHECK constraint'lerini gevşet — yeni
  // siteler farklı blok adları kullanabilsin.
  // Knex .enu CHECK constraint adı tahmini: daireler_blok_check
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_blok_check');
  await knex.raw('ALTER TABLE daireler DROP CONSTRAINT IF EXISTS daireler_sira_no_check');
  await knex.raw('ALTER TABLE daireler ALTER COLUMN blok TYPE VARCHAR(16)');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE daireler ALTER COLUMN blok TYPE CHAR(1)");
  await knex.raw("ALTER TABLE daireler ADD CONSTRAINT daireler_blok_check CHECK (blok IN ('A','B','C','D'))");
  await knex.raw("ALTER TABLE daireler ADD CONSTRAINT daireler_sira_no_check CHECK (sira_no BETWEEN 1 AND 34)");
  await knex.schema.alterTable('sites', (t) => {
    t.dropColumn('blok_yapisi');
  });
};
