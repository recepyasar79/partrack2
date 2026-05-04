const path = require('path');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';

  if (!process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
    console.log('[test] DATABASE_URL veya DATABASE_URL_TEST bulunamadi. Route testleri atlanacak.');
    return;
  }

  const knex = require('knex');
  const knexConfig = require('./knexfile');
  const knexDb = knex(knexConfig.test);

  const migrationsDir = path.join(__dirname, 'database/migrations');
  await knexDb.migrate.latest({ directory: migrationsDir });

  const { hashPassword } = require('./backend/src/utils/auth');
  const hash = await hashPassword('TestPass123!');
  const existing = await knexDb('users').where({ kullanici_adi: 'testadmin' }).first();
  if (!existing) {
    await knexDb('users').insert({
      kullanici_adi: 'testadmin',
      sifre_hash: hash,
      rol: 'yonetici',
      aktif: true,
    });
  }

  global.__testKnex__ = knexDb;
};
