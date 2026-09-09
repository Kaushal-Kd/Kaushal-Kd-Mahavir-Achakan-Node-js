/**
 * Create the MySQL database defined by DB_NAME if it does not already exist.
 *
 * Run it before the first migration:
 *   npm run db:create --workspace @wrs/backend
 *
 * The connecting user must have `CREATE` privilege on the server. If the
 * database already exists the script exits cleanly with code 0.
 */
import mysql from 'mysql2/promise';

import { env } from '../config/env.js';

async function main() {
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: false,
  });

  try {
    const [rows] = await conn.query('SHOW DATABASES LIKE ?', [env.DB_NAME]);
    if (rows.length > 0) {
      console.log(`[db:create] Database "${env.DB_NAME}" already exists on ${env.DB_HOST}.`);
      return;
    }

    const sql = `CREATE DATABASE \`${env.DB_NAME.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
    await conn.query(sql);
    console.log(`[db:create] \u2705 Created database "${env.DB_NAME}" on ${env.DB_HOST}.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  if (err && err.code === 'ER_DBACCESS_DENIED_ERROR') {
    console.error(
      `[db:create] \u274C User "${env.DB_USER}" lacks CREATE privilege on ${env.DB_HOST}.\n` +
        `Ask the DBA to run:\n` +
        `  CREATE DATABASE \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n` +
        `  GRANT ALL PRIVILEGES ON \`${env.DB_NAME}\`.* TO '${env.DB_USER}'@'%';`
    );
  } else {
    console.error('[db:create] Failed:', err.message);
  }
  process.exit(1);
});
