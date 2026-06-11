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
      // Sertifika doğrulaması varsayılan AÇIK — rejectUnauthorized:false DB
      // trafiğini MITM'e açar. Neon sertifikaları public CA imzalı (ISRG),
      // Node'un sistem CA'larıyla doğrulanır. Doğrulamanın imkansız olduğu
      // bir provider'a geçilirse PGSSL_NO_VERIFY=1 escape hatch.
      ssl: process.env.PGSSL_NO_VERIFY === '1'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true },
    },
    pool: { min: 2, max: 20 },
    // Neon: pool mode 'transaction' kullanılıyorsa max 1-2 önerilir.
    // session mode için daha yüksek pool limitleri ayarlanabilir.
  },
};
