/**
 * Multi-tenant Faz Ü1.1 — sites tablosu + users genişletme.
 *
 * - YENİ tablo: sites. Her tenant burada. id BIGSERIAL (URL/path
 *   okunabilirliği için UUID değil); slug subdomain veya path prefix
 *   routing için ileride kullanılacak.
 * - users.site_id eklendi (NULL = superadmin, dolu = o site'ye bağlı user).
 * - users.rol enum'a 'superadmin' ve 'site_yonetici' eklendi.
 *   Mevcut 'yonetici' role 'site_yonetici'ye taşınır (rename değil,
 *   gerçek değer update + eski enum value korunmaz).
 * - Default site (id=1, slug=varsayilan) oluşturulur, mevcut tüm user'lar
 *   buna bağlanır. Bu olmadan site_id NOT NULL constraint backfill'sız
 *   eklenemez (Ü1.2'de domain tabloları da bu site'ye bağlanacak).
 *
 * Down: enum'dan yeni değerler çıkarmak destructive (var olan superadmin
 * satırları kalırsa CHECK ihlali). Down olarak site_yonetici→yonetici
 * geri swap'i yapıyoruz, superadmin satırları silinmek zorunda. Bu yüzden
 * down rollback'i production'da KULLANILMAMALI; sadece test/dev için.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  // 1. sites tablosu
  await knex.schema.createTable('sites', (t) => {
    t.bigIncrements('id').primary();
    t.string('ad', 128).notNullable().comment('Site adı, örn: "Akasya Evleri"');
    t.string('slug', 64).notNullable().unique().comment('URL-safe kısa ad, örn: "akasya"');
    t.boolean('aktif').notNullable().defaultTo(true);
    t.string('plan', 32).notNullable().defaultTo('baslangic').comment('baslangic / standart / pro / kurumsal');
    t.timestamp('olusturma_zamani', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('aktif');
  });

  // 2. Default site — mevcut single-tenant verisi buraya bind edilir
  const [defaultSite] = await knex('sites').insert({
    id: 1,
    ad: 'Varsayılan Site',
    slug: 'varsayilan',
    aktif: true,
    plan: 'baslangic',
  }).returning('id');
  // PostgreSQL SERIAL sequence id=1 hardcode insert'ten sonra kayar; sonraki
  // INSERT id=2 değil yine 1 olabilir. Manuel reset.
  await knex.raw("SELECT setval('sites_id_seq', (SELECT MAX(id) FROM sites))");

  // 3. users.site_id ekle, default site'ye backfill
  await knex.schema.alterTable('users', (t) => {
    t.bigInteger('site_id').nullable()
      .references('id').inTable('sites')
      .comment('NULL = superadmin (platform sahibi); dolu = site_yonetici/guvenlik');
  });
  await knex('users').update({ site_id: 1 });

  // 4. rol enum'unu yeniden yarat — yeni değerler 'superadmin', 'site_yonetici', 'guvenlik'
  //    Knex 'useNative: false' ile enum'u VARCHAR + CHECK olarak yazıyor; CHECK
  //    constraint adı PostgreSQL'de 'users_rol_check' formatında olur. Onu
  //    drop edip yenisini ekliyoruz.
  //    Önce mevcut 'yonetici' satırları 'site_yonetici'ye taşı, sonra
  //    CHECK'i değiştir.
  await knex.raw("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check");
  await knex('users').where({ rol: 'yonetici' }).update({ rol: 'site_yonetici' });
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_rol_check
    CHECK (rol IN ('superadmin', 'site_yonetici', 'guvenlik'))
  `);

  // 5. Superadmin için site_id'nin NULL olmasını, diğerleri için zorunluluğunu
  //    garanti eden ek CHECK. NOT NULL koyamıyoruz çünkü superadmin NULL olmalı.
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_site_id_role_consistency_check
    CHECK (
      (rol = 'superadmin' AND site_id IS NULL) OR
      (rol IN ('site_yonetici', 'guvenlik') AND site_id IS NOT NULL)
    )
  `);

  // 6. Performans index — login + rol/site_id sorgularında kullanılır
  await knex.raw('CREATE INDEX users_site_id_idx ON users(site_id)');
  await knex.raw('CREATE INDEX users_rol_idx ON users(rol)');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS users_rol_idx');
  await knex.raw('DROP INDEX IF EXISTS users_site_id_idx');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_site_id_role_consistency_check');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check');
  // Superadmin satırlarını sil — eski schema yok
  await knex('users').where({ rol: 'superadmin' }).del();
  await knex('users').where({ rol: 'site_yonetici' }).update({ rol: 'yonetici' });
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_rol_check
    CHECK (rol IN ('yonetici', 'guvenlik'))
  `);
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('site_id');
  });
  await knex.schema.dropTableIfExists('sites');
};
