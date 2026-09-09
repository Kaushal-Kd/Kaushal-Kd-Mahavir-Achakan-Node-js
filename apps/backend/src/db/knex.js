import Knex from 'knex';

import { env } from '../config/env.js';

const config = {
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
    // Force every connection to UTC so TIMESTAMP reads/writes stay UTC
    // regardless of the DB server or host machine timezone (matches
    // mysql2 `timezone: 'Z'`). India-time display is applied at render time.
    afterCreate(conn, done) {
      conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
    },
  },
  acquireConnectionTimeout: 60000,
};

const knex = Knex(config);

export default knex;
