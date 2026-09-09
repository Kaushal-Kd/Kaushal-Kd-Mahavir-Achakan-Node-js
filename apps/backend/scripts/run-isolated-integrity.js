import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let localConfig = {};
try {
  localConfig = dotenv.parse(readFileSync(resolve(backendRoot, '.env')));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const configuration = { ...localConfig, ...process.env };
const database = `wrs_test_integrity_${Date.now()}_${randomUUID().slice(0, 8)}`;
if (
  !/^wrs_test_integrity_[0-9]+_[a-f0-9]{8}$/.test(database) ||
  database === configuration.DB_NAME
) {
  throw new Error('Refusing an unsafe integration database target');
}
const connection = await mysql.createConnection({
  host: configuration.WRS_TEST_DB_HOST || configuration.DB_HOST || '127.0.0.1',
  port: Number(configuration.WRS_TEST_DB_PORT || configuration.DB_PORT || 3306),
  user: configuration.WRS_TEST_DB_USER || configuration.DB_USER || 'root',
  password: configuration.WRS_TEST_DB_PASSWORD ?? configuration.DB_PASSWORD ?? '',
});
let created = false;
try {
  // CREATE without IF NOT EXISTS ensures this process owns the disposable target.
  await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [
    database,
  ]);
  created = true;
  console.info(
    `Running synthetic integration checks in ${database}; business database is excluded.`
  );
  const isolatedEnv = {
    ...configuration,
    NODE_ENV: 'test',
    WRS_TEST_MYSQL_INTEGRATION: '1',
    WRS_TEST_DB_NAME: database,
    WRS_TEST_SOURCE_DB_NAME: configuration.DB_NAME || '',
    WRS_TEST_DB_HOST: configuration.WRS_TEST_DB_HOST || configuration.DB_HOST || '127.0.0.1',
    WRS_TEST_DB_PORT: String(configuration.WRS_TEST_DB_PORT || configuration.DB_PORT || 3306),
    WRS_TEST_DB_USER: configuration.WRS_TEST_DB_USER || configuration.DB_USER || 'root',
    WRS_TEST_DB_PASSWORD: configuration.WRS_TEST_DB_PASSWORD ?? configuration.DB_PASSWORD ?? '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_FROM: '',
    GCS_KEY_FILE: '',
    GCS_CREDENTIALS_JSON: '',
    GCS_BUCKET_NAME: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
  };
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(backendRoot, 'scripts/test-transaction-integrity-mysql.js')],
      {
        cwd: backendRoot,
        env: isolatedEnv,
        stdio: 'inherit',
        windowsHide: true,
      }
    );
    child.on('error', reject);
    child.on('exit', (exitCode) => resolveCode(exitCode ?? 1));
  });
  process.exitCode = code;
} finally {
  if (created) {
    await connection.query('DROP DATABASE ??', [database]);
    console.info(
      `Removed disposable synthetic database ${database}; no business data was changed.`
    );
  }
  await connection.end();
}
