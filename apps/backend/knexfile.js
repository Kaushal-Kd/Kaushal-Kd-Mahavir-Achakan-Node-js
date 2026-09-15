import { env } from './src/config/env.js';

const LIVE_DB_NAME = 'wedding_rent_system';
if (env.DB_NAME === LIVE_DB_NAME && process.env.WRS_ALLOW_LIVE_MIGRATE !== '1') {
  console.error(
    `[knex] Refusing to run against live database "${LIVE_DB_NAME}". ` +
      `Point DB_NAME at wedding_rent_system_beta, or set WRS_ALLOW_LIVE_MIGRATE=1.`
  );
  process.exit(1);
}

const base = {
  client: 'mysql2',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      return next();
    },
  },
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    propagateCreateError: false,
    afterCreate(conn, done) {
      conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
    },
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './src/db/migrations',
    loadExtensions: ['.js'],
  },
  seeds: {
    directory: './src/db/seeds',
  },
  acquireConnectionTimeout: 60000,
};

export default {
  development: base,
  staging: base,
  production: base,
};
