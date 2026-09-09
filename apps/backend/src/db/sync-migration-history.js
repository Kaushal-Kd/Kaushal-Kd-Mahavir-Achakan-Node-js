/**
 * Reconcile knex_migrations with an existing schema.
 *
 * Used when tables already exist (e.g. restored dump, lost migration history)
 * but `migrate:latest` fails on the first createTable with "already exists".
 *
 * Walks pending migrations in order and stamps those whose schema changes are
 * already present, then exits so `migrate:latest` can apply only the rest.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import knex from 'knex';

import knexfile from '../../knexfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

const CREATE_TABLE_RE = /createTable\(\s*['"]([\w]+)['"]/g;
const DROP_TABLE_RE = /dropTable(?:IfExists)?\(\s*['"]([\w]+)['"]/g;
const ALTER_BLOCK_RE =
  /(?:alterTable|\.table)\(\s*['"]([\w]+)['"]\s*,\s*\((?:t|table)\)\s*=>\s*\{([\s\S]*?)\}\s*\)/g;
const ADD_COLUMN_RE =
  /(?:t|table)\.(?!dropColumn|foreign|index|unique|primary|comment|references)[a-zA-Z]+\(\s*['"]([\w]+)['"]/g;
const DROP_COLUMN_RE = /(?:t|table)\.dropColumn\(\s*['"]([\w]+)['"]\s*\)/g;
const RENAME_COLUMN_RE = /renameColumn\(\s*['"]([\w]+)['"]\s*,\s*['"]([\w]+)['"]\s*\)/g;
const SCHEMA_OP_RE = /createTable|dropTable|alterTable|\.table\(|renameColumn|dropColumn|renameTable/;

function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

function readMigrationContent(name) {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8');
}

function extractUpFunctionBody(content) {
  const markers = ['export async function up', 'export function up'];
  let start = -1;
  for (const marker of markers) {
    const idx = content.indexOf(marker);
    if (idx !== -1 && (start === -1 || idx < start)) start = idx;
  }
  if (start === -1) return content;

  const braceStart = content.indexOf('{', start);
  if (braceStart === -1) return content;

  let depth = 0;
  for (let i = braceStart; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(braceStart + 1, i);
    }
  }

  return content;
}

function migrationUpContent(content) {
  return extractUpFunctionBody(content);
}

function loadMigrationContents(files) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const name of files) {
    map.set(name, readMigrationContent(name));
  }
  return map;
}

function extractCreateTables(content) {
  const names = [];
  for (const match of migrationUpContent(content).matchAll(CREATE_TABLE_RE)) {
    names.push(match[1]);
  }
  return names;
}

function extractDropTables(content) {
  const names = [];
  for (const match of migrationUpContent(content).matchAll(DROP_TABLE_RE)) {
    names.push(match[1]);
  }
  return names;
}

function extractAlterChanges(content) {
  /** @type {{ table: string, adds: string[], drops: string[] }[]} */
  const blocks = [];

  for (const match of migrationUpContent(content).matchAll(ALTER_BLOCK_RE)) {
    const table = match[1];
    const body = match[2];
    const adds = [];
    const drops = [];
    const renames = [];

    for (const addMatch of body.matchAll(ADD_COLUMN_RE)) {
      adds.push(addMatch[1]);
    }
    for (const dropMatch of body.matchAll(DROP_COLUMN_RE)) {
      drops.push(dropMatch[1]);
    }
    for (const renameMatch of body.matchAll(RENAME_COLUMN_RE)) {
      renames.push({ from: renameMatch[1], to: renameMatch[2] });
    }

    if (adds.length || drops.length || renames.length) {
      blocks.push({ table, adds, drops, renames });
    }
  }

  return blocks;
}

function hasSchemaOperations(content) {
  return SCHEMA_OP_RE.test(migrationUpContent(content));
}

function buildDropRegistry(contentsByName) {
  /** @type {Set<string>} */
  const droppedTables = new Set();
  /** @type {Set<string>} */
  const droppedColumns = new Set();

  for (const content of contentsByName.values()) {
    for (const table of extractDropTables(content)) {
      droppedTables.add(table);
    }
    for (const block of extractAlterChanges(content)) {
      for (const column of block.drops) {
        droppedColumns.add(`${block.table}.${column}`);
      }
    }
  }

  return { droppedTables, droppedColumns };
}

/** @param {string[]} files @param {Map<string, string>} contentsByName */
function buildRecreateRegistry(files, contentsByName) {
  /** @type {Map<string, string[]>} */
  const map = new Map();

  for (const name of files) {
    const content = contentsByName.get(name) || '';
    for (const table of extractCreateTables(content)) {
      if (!map.has(table)) map.set(table, []);
      map.get(table).push(name);
    }
  }

  return map;
}

async function getAppliedNames(db) {
  const hasTable = await db.schema.hasTable('knex_migrations');
  if (!hasTable) return new Set();

  const rows = await db('knex_migrations').select('name');
  return new Set(rows.map((row) => row.name));
}

async function ensureMigrationsTable(db) {
  const exists = await db.schema.hasTable('knex_migrations');
  if (exists) return;

  await db.schema.createTable('knex_migrations', (t) => {
    t.increments('id');
    t.string('name', 255);
    t.integer('batch');
    t.timestamp('migration_time');
  });
}

async function createTableSatisfied(db, table, migrationName, recreateRegistry, files, contentsByName) {
  if (await db.schema.hasTable(table)) return true;

  const creators = recreateRegistry.get(table) || [];
  const lastCreator = creators[creators.length - 1];

  if (migrationName !== lastCreator) return true;

  for (const name of files) {
    if (name <= migrationName) continue;
    const drops = extractDropTables(contentsByName.get(name) || '');
    if (drops.includes(table)) return true;
  }

  return false;
}

async function dropTableSatisfied(db, table, migrationName, recreateRegistry) {
  if (!(await db.schema.hasTable(table))) return true;

  const creators = recreateRegistry.get(table) || [];
  return creators.some((name) => name > migrationName);
}

async function addColumnSatisfied(db, table, column, droppedColumns) {
  if (!(await db.schema.hasTable(table))) return false;
  if (await db.schema.hasColumn(table, column)) return true;
  return droppedColumns.has(`${table}.${column}`);
}

async function migrationAlreadyApplied(
  db,
  content,
  dropRegistry,
  recreateRegistry,
  migrationName,
  files,
  contentsByName
) {
  const { droppedColumns } = dropRegistry;

  for (const table of extractCreateTables(content)) {
    if (!(await createTableSatisfied(db, table, migrationName, recreateRegistry, files, contentsByName))) {
      return false;
    }
  }

  for (const table of extractDropTables(content)) {
    if (!(await dropTableSatisfied(db, table, migrationName, recreateRegistry))) return false;
  }

  for (const block of extractAlterChanges(content)) {
    if (!(await db.schema.hasTable(block.table))) return false;
    for (const column of block.adds) {
      if (!(await addColumnSatisfied(db, block.table, column, droppedColumns))) return false;
    }
    for (const column of block.drops) {
      if (await db.schema.hasColumn(block.table, column)) return false;
    }
    for (const rename of block.renames || []) {
      const fromExists = await db.schema.hasColumn(block.table, rename.from);
      const toExists = await db.schema.hasColumn(block.table, rename.to);
      if (fromExists && !toExists) return false;
      if (!fromExists && !toExists) return false;
    }
  }

  return true;
}

async function stampMigrations(db, names) {
  if (!names.length) return;

  await ensureMigrationsTable(db);

  const maxRow = await db('knex_migrations').max('batch as max').first();
  const batch = Number(maxRow?.max || 0) + 1;
  const migrationTime = new Date();

  await db('knex_migrations').insert(
    names.map((name) => ({
      name,
      batch,
      migration_time: migrationTime,
    }))
  );
}

/**
 * @returns {Promise<number>} count stamped this pass
 */
async function syncPass(db, files, contentsByName, dropRegistry, recreateRegistry) {
  const applied = await getAppliedNames(db);
  const pending = files.filter((name) => !applied.has(name));
  if (!pending.length) return 0;

  /** @type {string[]} */
  const toStamp = [];

  for (const name of pending) {
    const content = contentsByName.get(name) || readMigrationContent(name);
    if (/export\s+const\s+requiresExplicitRun\s*=\s*true/.test(content)) break;
    const schemaOps = hasSchemaOperations(content);

    if (schemaOps) {
      const appliedAlready = await migrationAlreadyApplied(
        db,
        content,
        dropRegistry,
        recreateRegistry,
        name,
        files,
        contentsByName
      );
      if (!appliedAlready) break;
      toStamp.push(name);
      continue;
    }

    if (!toStamp.length && pending[0] === name) {
      break;
    }
    toStamp.push(name);
  }

  if (!toStamp.length) return 0;

  await stampMigrations(db, toStamp);
  console.log(
    `[migrate:sync] Stamped ${toStamp.length} migration(s) already reflected in schema:`,
    toStamp.join(', ')
  );
  return toStamp.length;
}

async function main() {
  const env = process.env.NODE_ENV || 'development';
  const config = knexfile[env];
  if (!config) {
    throw new Error(`Unknown NODE_ENV "${env}" for knex config`);
  }

  const db = knex(config);

  try {
    const files = listMigrationFiles();
    const contentsByName = loadMigrationContents(files);
    const dropRegistry = buildDropRegistry(contentsByName);
    const recreateRegistry = buildRecreateRegistry(files, contentsByName);

    const shopsExists = await db.schema.hasTable('shops');
    if (!shopsExists) {
      console.log('[migrate:sync] Fresh database detected; nothing to reconcile.');
      return;
    }

    let totalStamped = 0;
    for (;;) {
      const stamped = await syncPass(db, files, contentsByName, dropRegistry, recreateRegistry);
      if (!stamped) break;
      totalStamped += stamped;
    }

    if (!totalStamped) {
      const applied = await getAppliedNames(db);
      const pending = files.filter((name) => !applied.has(name));
      if (pending.length) {
        console.log(
          '[migrate:sync] Existing schema does not match pending migrations; running migrate:latest as-is.'
        );
      } else {
        console.log('[migrate:sync] No pending migrations to reconcile.');
      }
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('[migrate:sync] Failed:', err.message);
  process.exit(1);
});
