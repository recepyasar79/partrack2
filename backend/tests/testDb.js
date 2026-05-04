const { Manager } = require('pg-mem');

let sharedDb = null;

async function getTestDb() {
  if (sharedDb) return sharedDb;

  const manager = new Manager();
  const memDb = manager.createDatabase();
  sharedDb = memDb;

  await memDb.public.none("SET timezone TO 'Europe/Istanbul'");
  await memDb.public.none("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  const path = require('path');
  const knex = require('knex');
  const knexDb = knex({
    client: 'pg',
    connection: memDb.adapters.createKnexStatic(),
    pool: { min: 1, max: 1 },
  });

  const migrationsDir = path.join(__dirname, '../../database/migrations');
  const fs = require('fs');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    if (migration.up) await migration.up(knexDb);
  }

  if (process.env.BOOTSTRAP_ADMIN_USER) {
    const { hashPassword } = require('../../backend/src/utils/auth');
    const hash = await hashPassword(process.env.BOOTSTRAP_ADMIN_PASS || 'TestPass123!');
    await knexDb('users').insert({
      kullanici_adi: process.env.BOOTSTRAP_ADMIN_USER,
      sifre_hash: hash,
      rol: 'yonetici',
      aktif: true,
    });
  }

  return { db: knexDb, rawDb: memDb };
}

function resetTestDb() {
  sharedDb = null;
}

module.exports = { getTestDb, resetTestDb };
