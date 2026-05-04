require('dotenv').config({ path: '../.env' });

const path = require('path');

const sharedConfig = {
  client: 'pg',
  migrations: {
    directory: path.join(__dirname, '../database/migrations'),
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: path.join(__dirname, '../database/seeds'),
  },
};

module.exports = {
  development: {
    ...sharedConfig,
    connection: process.env.DATABASE_URL || {
      host: 'localhost',
      port: 5432,
      database: 'parktrack',
      user: 'postgres',
      password: 'postgres',
    },
    pool: { min: 2, max: 10 },
  },
  test: {
    ...sharedConfig,
    connection: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    pool: { min: 1, max: 5 },
  },
  production: {
    ...sharedConfig,
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 20 },
    // Neon: pool mode 'transaction' kullanılıyorsa max 1-2 önerilir.
    // session mode için daha yüksek pool limitleri ayarlanabilir.
  },
};
