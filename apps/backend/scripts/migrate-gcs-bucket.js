#!/usr/bin/env node
/**
 * Copy-only cutover from the live staging bucket to weddingachakan.
 *
 * Does not delete source objects. Loads both service-account JSON files
 * directly (does not use GCS_KEY_FILE).
 *
 *   node scripts/migrate-gcs-bucket.js --dry-run
 *   node scripts/migrate-gcs-bucket.js --copy --ensure-public
 *   node scripts/migrate-gcs-bucket.js --copy
 *   node scripts/migrate-gcs-bucket.js --rewrite-db --backup
 */
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import { Storage } from '@google-cloud/storage';
import mysql from 'mysql2/promise';

import { env } from '../src/config/env.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_BUCKET = 'wedding-crm-images-staging';
const NEW_BUCKET = 'weddingachakan';
const OLD_KEY = resolve(BACKEND_ROOT, 'credentials/wedding-rental-system-63762e16f79d.json');
const NEW_KEY = resolve(BACKEND_ROOT, 'credentials/new-wedding-key.json');
const OLD_PREFIX = 'https://storage.googleapis.com/wedding-crm-images-staging/';
const NEW_PREFIX = 'https://storage.googleapis.com/weddingachakan/';
const NEEDLE = 'wedding-crm-images-staging';
const COPY_CONCURRENCY = 6;
const STRING_TYPES = new Set([
  'char',
  'varchar',
  'tinytext',
  'text',
  'mediumtext',
  'longtext',
  'json',
]);

const args = new Set(process.argv.slice(2));
const doDryRun = args.has('--dry-run');
const doCopy = args.has('--copy');
const doEnsurePublic = args.has('--ensure-public');
const doRewriteDb = args.has('--rewrite-db');
const doBackup = args.has('--backup');

function loadCredentials(path) {
  const credentials = JSON.parse(readFileSync(path, 'utf8'));
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(`Invalid service account JSON: ${path}`);
  }
  return credentials;
}

function storageFor(credentials) {
  return new Storage({
    projectId: credentials.project_id,
    credentials,
  });
}

async function listFileSummaries(bucket) {
  const files = [];
  let pageToken;
  do {
    const [page, , response] = await bucket.getFiles({
      autoPaginate: false,
      pageToken,
    });
    for (const file of page) {
      files.push({
        name: file.name,
        size: Number(file.metadata?.size || 0),
        contentType: file.metadata?.contentType || undefined,
      });
    }
    pageToken = response?.nextPageToken;
  } while (pageToken);
  return files;
}

function totalBytes(files) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

async function copyObject(srcBucket, destBucket, summary, destSizes) {
  const destSize = destSizes.get(summary.name);
  if (destSize != null && destSize === summary.size) return 'skipped';

  const srcFile = srcBucket.file(summary.name);
  const destFile = destBucket.file(summary.name);
  await pipeline(
    srcFile.createReadStream(),
    destFile.createWriteStream({
      resumable: summary.size > 5 * 1024 * 1024,
      metadata: summary.contentType ? { contentType: summary.contentType } : undefined,
    })
  );
  return destSize == null ? 'copied' : 'replaced';
}

async function runPool(items, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(COPY_CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current, index);
    }
  });
  await Promise.all(workers);
}

async function ensurePublicRead(bucket) {
  const [policy] = await bucket.iam.getPolicy({ requestedPolicyVersion: 3 });
  policy.bindings = policy.bindings || [];
  const binding = policy.bindings.find((row) => row.role === 'roles/storage.objectViewer');
  if (binding?.members?.includes('allUsers')) {
    console.log('[gcs:migrate] dest bucket already allows public object reads');
    return;
  }
  if (binding) {
    binding.members = [...new Set([...(binding.members || []), 'allUsers'])];
  } else {
    policy.bindings.push({ role: 'roles/storage.objectViewer', members: ['allUsers'] });
  }
  await bucket.iam.setPolicy(policy);
  console.log('[gcs:migrate] granted allUsers Storage Object Viewer on dest bucket');
}

async function openDatabase() {
  return mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: 'utf8mb4',
    connectTimeout: 60000,
  });
}

async function listUrlColumns(database) {
  const [rows] = await database.query(
    `SELECT table_name AS tableName, column_name AS columnName, data_type AS dataType
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND data_type IN (${[...STRING_TYPES].map(() => '?').join(',')})`,
    [...STRING_TYPES]
  );
  return rows.filter((row) => !String(row.tableName).startsWith('knex_'));
}

async function countNeedle(database, table, column) {
  const [rows] = await database.query(
    'SELECT COUNT(*) AS n FROM ?? WHERE ?? LIKE ?',
    [table, column, `%${NEEDLE}%`]
  );
  return Number(rows[0]?.n || 0);
}

async function scanDb(database) {
  const columns = await listUrlColumns(database);
  const hits = [];
  for (const col of columns) {
    try {
      const count = await countNeedle(database, col.tableName, col.columnName);
      if (count > 0) hits.push({ ...col, count });
    } catch {
      // Skip views / generated columns that cannot be queried this way.
    }
  }
  return hits;
}

async function backupAndRewrite(database) {
  const hits = await scanDb(database);
  if (hits.length === 0) {
    console.log('[gcs:migrate] no database rows contain the old bucket name');
    return hits;
  }

  const backupDir = resolve(BACKEND_ROOT, 'tmp/gcs-migration-backup');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = resolve(backupDir, `url-backup-${stamp}.jsonl`);
  const out = createWriteStream(backupPath, { encoding: 'utf8' });

  console.log(`[gcs:migrate] writing URL backup to ${backupPath}`);

  for (const hit of hits) {
    const [idCols] = await database.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'id'`,
      [hit.tableName]
    );
    const hasId = Number(idCols[0]?.n || 0) > 0;
    const sql = hasId
      ? 'SELECT `id` AS id, ?? AS value FROM ?? WHERE ?? LIKE ?'
      : 'SELECT ?? AS value FROM ?? WHERE ?? LIKE ?';
    const params = hasId
      ? [hit.columnName, hit.tableName, hit.columnName, `%${NEEDLE}%`]
      : [hit.columnName, hit.tableName, hit.columnName, `%${NEEDLE}%`];
    const [rows] = await database.query(sql, params);
    for (const row of rows) {
      out.write(
        `${JSON.stringify({ table: hit.tableName, column: hit.columnName, id: row.id ?? null, value: row.value })}\n`
      );
    }
  }
  await new Promise((resolveWrite, rejectWrite) => {
    out.end((err) => (err ? rejectWrite(err) : resolveWrite()));
  });

  for (const hit of hits) {
    await database.query('UPDATE ?? SET ?? = REPLACE(??, ?, ?) WHERE ?? LIKE ?', [
      hit.tableName,
      hit.columnName,
      hit.columnName,
      OLD_PREFIX,
      NEW_PREFIX,
      hit.columnName,
      `%${NEEDLE}%`,
    ]);
    await database.query('UPDATE ?? SET ?? = REPLACE(??, ?, ?) WHERE ?? LIKE ?', [
      hit.tableName,
      hit.columnName,
      hit.columnName,
      NEEDLE,
      NEW_BUCKET,
      hit.columnName,
      `%${NEEDLE}%`,
    ]);
    const remaining = await countNeedle(database, hit.tableName, hit.columnName);
    console.log(
      `[gcs:migrate] rewrote ${hit.tableName}.${hit.columnName} (${hit.count} matched, ${remaining} leftover)`
    );
    if (remaining > 0) {
      throw new Error(
        `${hit.tableName}.${hit.columnName} still contains ${NEEDLE}. Backup is at ${backupPath}`
      );
    }
  }
  return hits;
}

function printUsage() {
  console.error('Usage: node scripts/migrate-gcs-bucket.js --dry-run | --copy [--ensure-public] | --rewrite-db --backup');
}

async function main() {
  if (!doDryRun && !doCopy && !doRewriteDb && !doEnsurePublic) {
    printUsage();
    process.exit(1);
  }
  if (doRewriteDb && !doBackup) {
    console.error('[gcs:migrate] --rewrite-db requires --backup');
    process.exit(1);
  }

  const oldCreds = loadCredentials(OLD_KEY);
  const newCreds = loadCredentials(NEW_KEY);
  const srcBucket = storageFor(oldCreds).bucket(OLD_BUCKET);
  const destBucket = storageFor(newCreds).bucket(NEW_BUCKET);

  console.log(`[gcs:migrate] source=${OLD_BUCKET} client=${oldCreds.client_email}`);
  console.log(`[gcs:migrate] dest=${NEW_BUCKET} client=${newCreds.client_email}`);

  if (doDryRun || doCopy) {
    console.log('[gcs:migrate] listing objects…');
    const [sourceFiles, destFiles] = await Promise.all([
      listFileSummaries(srcBucket),
      listFileSummaries(destBucket),
    ]);
    const destSizes = new Map(destFiles.map((file) => [file.name, file.size]));
    const missing = sourceFiles.filter((file) => destSizes.get(file.name) !== file.size);
    console.log(
      `[gcs:migrate] source=${sourceFiles.length} files (${totalBytes(sourceFiles)} bytes)`
    );
    console.log(`[gcs:migrate] dest=${destFiles.length} files (${totalBytes(destFiles)} bytes)`);
    console.log(`[gcs:migrate] to copy/replace=${missing.length}`);

    if (doDryRun) {
      try {
        const database = await openDatabase();
        try {
          const hits = await scanDb(database);
          if (hits.length === 0) console.log('[gcs:migrate] database: no old-bucket URLs');
          else {
            console.log('[gcs:migrate] database URL hits:');
            for (const hit of hits) {
              console.log(`  ${hit.tableName}.${hit.columnName} = ${hit.count}`);
            }
          }
        } finally {
          await database.end();
        }
      } catch (error) {
        console.warn('[gcs:migrate] database scan skipped:', error.message);
      }
    }

    if (doCopy) {
      if (missing.length === 0) {
        console.log('[gcs:migrate] copy skipped; dest already matches source');
      } else {
      let copied = 0;
      let replaced = 0;
      let skipped = 0;
      let failed = 0;
      await runPool(sourceFiles, async (summary, doneCount) => {
        try {
          const result = await copyObject(srcBucket, destBucket, summary, destSizes);
          if (result === 'copied') copied += 1;
          else if (result === 'replaced') replaced += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          console.error(`[gcs:migrate] failed ${summary.name}: ${error.message}`);
        }
        if (doneCount % 50 === 0 || doneCount === sourceFiles.length) {
          console.log(
            `[gcs:migrate] progress ${doneCount}/${sourceFiles.length} copied=${copied} replaced=${replaced} skipped=${skipped} failed=${failed}`
          );
        }
      });
      if (failed > 0) {
        throw new Error(`Copy finished with ${failed} failures. Old bucket was not changed.`);
      }
      const afterDest = await listFileSummaries(destBucket);
      const destSizesAfter = new Map(afterDest.map((file) => [file.name, file.size]));
      const stillMissing = sourceFiles.filter((file) => destSizesAfter.get(file.name) !== file.size);
      console.log(
        `[gcs:migrate] copy done. dest now ${afterDest.length} files. still missing/mismatch=${stillMissing.length}`
      );
      if (stillMissing.length > 0) {
        throw new Error('Destination still missing source objects. Old bucket was not changed.');
      }
      }
    }
  }

  if (doEnsurePublic) {
    await ensurePublicRead(destBucket);
  }

  if (doRewriteDb) {
    const database = await openDatabase();
    try {
      await backupAndRewrite(database);
      const leftover = await scanDb(database);
      if (leftover.length > 0) {
        throw new Error(
          `Rewrite incomplete: ${leftover.map((row) => `${row.tableName}.${row.columnName}`).join(', ')}`
        );
      }
      console.log('[gcs:migrate] database rewrite complete; no leftover old-bucket URLs');
    } finally {
      await database.end();
    }
  }

  console.log('[gcs:migrate] finished');
}

main().catch((error) => {
  console.error('[gcs:migrate] failed:', error.message || error);
  process.exit(1);
});
