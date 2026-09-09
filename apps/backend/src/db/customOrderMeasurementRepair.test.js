import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEASUREMENT_RENAME_MIGRATION,
  MEASUREMENT_REPAIR_ARCHIVE,
  mergePreservedMeasurements,
  prepareCustomOrderMeasurementRename,
  restoreCustomOrderMeasurements,
} from './customOrderMeasurementRepair.js';
import { up as historicalMigration } from './migrations/20260901120000_custom_order_fields_remove_key.js';

function fixture({ applied = false, stage = false, rows = [] } = {}) {
  const state = { current: {
    knex_migrations: { columns: new Set(['name']), rows: applied ? [{ name: MEASUREMENT_RENAME_MIGRATION }] : [] },
    custom_orders: { columns: new Set(['id', 'shop_id', 'measurements', 'updated_at', ...(stage ? ['measurements_by_id'] : [])]), rows: structuredClone(rows) },
    custom_order_field_definitions: { columns: new Set(['id', 'shop_id', 'label', ...(applied ? [] : ['field_key'])]), rows: [
      { id: 'field-a', shop_id: 'shop-a', field_key: 'chest', label: 'Chest' },
      { id: 'field-b', shop_id: 'shop-b', field_key: 'chest', label: 'Chest' },
    ] },
  } };
  const make = (storage) => {
    function db(name) {
      const predicates = [];
      let fields;
      const matching = () => storage.current[name].rows.filter((row) => predicates.every((fn) => fn(row)));
      const project = (row) => !row ? row : !fields || fields.includes('*') ? structuredClone(row)
        : Object.fromEntries(fields.map((key) => [key, structuredClone(row[key])]));
      const query = {
        where(values) { predicates.push((row) => Object.entries(values).every(([key, value]) => row[key] === value)); return this; },
        whereNull(key) { predicates.push((row) => row[key] == null); return this; },
        whereNotNull(key) { predicates.push((row) => row[key] != null); return this; },
        select(...keys) { fields = keys; return this; },
        forUpdate() { return this; },
        async first() { return project(matching()[0]); },
        async update(patch) { for (const row of matching()) Object.assign(row, patch); },
        insert(value) {
          return { onConflict: (key) => ({ ignore: async () => {
            if (!storage.current[name].rows.some((row) => row[key] === value[key])) {
              storage.current[name].rows.push(structuredClone(value));
            }
          } }) };
        },
        then(resolve, reject) { return Promise.resolve(matching().map(project)).then(resolve, reject); },
      };
      return query;
    }
    const builder = (table) => {
      const chain = { nullable() { return this; }, notNullable() { return this; }, primary() { return this; }, defaultTo() { return this; } };
      const column = (key) => { table.columns.add(key); return chain; };
      return { json: column, uuid: column, timestamp: column, string: column,
        dropColumn(key) { table.columns.delete(key); for (const row of table.rows) delete row[key]; },
        renameColumn(from, to) {
          if (table.columns.has(to)) throw new Error(`duplicate column ${to}`);
          table.columns.delete(from); table.columns.add(to);
          for (const row of table.rows) { row[to] = row[from]; delete row[from]; }
        },
        dropUnique() {}, unique() {},
      };
    };
    db.fn = { now: () => new Date() };
    db.schema = {
      hasTable: async (name) => Boolean(storage.current[name]),
      hasColumn: async (name, column) => storage.current[name]?.columns.has(column) || false,
      async createTable(name, callback) {
        storage.current[name] = { columns: new Set(), rows: [] };
        callback(builder(storage.current[name]));
      },
      async alterTable(name, callback) { callback(builder(storage.current[name])); },
    };
    db.transaction = async (callback) => {
      const draft = { current: structuredClone(storage.current) };
      const value = await callback(make(draft));
      storage.current = draft.current;
      return value;
    };
    return db;
  };
  return { db: make(state), state };
}

test('reproduces the immutable historical migration duplicate-target failure', async () => {
  const { db } = fixture();
  await assert.rejects(historicalMigration(db), /duplicate column measurements/);
});

test('preflight makes the real historical migration complete on a fresh schema', async () => {
  const { db } = fixture();
  await prepareCustomOrderMeasurementRename(db);
  await historicalMigration(db);
  await restoreCustomOrderMeasurements(db);
  assert.equal(await db.schema.hasColumn('custom_orders', 'measurements'), true);
  assert.equal(await db.schema.hasColumn('custom_orders', 'measurements_by_id'), false);
  assert.equal(await db.schema.hasColumn('custom_order_field_definitions', 'field_key'), false);
});

test('populated source and partial stage values survive the historical conversion shop-wise', async () => {
  const source = { chest: 40, unknown: 'Keep this', blank: '', nullable: null };
  const { db, state } = fixture({ stage: true, rows: [
    { id: 'order-a', shop_id: 'shop-a', measurements: JSON.stringify(source), measurements_by_id: JSON.stringify({ extra_stage: 'old staged value' }) },
    { id: 'order-b', shop_id: 'shop-b', measurements: JSON.stringify({ chest: ' 42 ' }) },
  ] });
  await prepareCustomOrderMeasurementRename(db);
  await prepareCustomOrderMeasurementRename(db);
  await historicalMigration(db);
  await restoreCustomOrderMeasurements(db);
  const [a, b] = state.current.custom_orders.rows;
  assert.deepEqual(JSON.parse(a.measurements), { 'field-a': 40, unknown: 'Keep this', blank: '', nullable: null, extra_stage: 'old staged value' });
  assert.deepEqual(JSON.parse(b.measurements), { 'field-b': ' 42 ' });
  assert.deepEqual(JSON.parse(state.current[MEASUREMENT_REPAIR_ARCHIVE].rows[0].original_measurements), source);
  a.measurements = JSON.stringify({ 'field-a': 'later user edit' });
  await restoreCustomOrderMeasurements(db);
  assert.equal(state.current.custom_orders.rows[0].measurements, JSON.stringify({ 'field-a': 'later user edit' }));
});

test('already-migrated business schemas and measurements are completely untouched', async () => {
  const { db, state } = fixture({ applied: true, rows: [
    { id: 'order-a', shop_id: 'shop-a', measurements: JSON.stringify({ 'field-a': '44' }) },
  ] });
  const before = structuredClone(state.current);
  await prepareCustomOrderMeasurementRename(db);
  await restoreCustomOrderMeasurements(db);
  assert.deepEqual(state.current, before);
});

test('canonical values, original-key collisions and unusual JSON are preserved', () => {
  assert.deepEqual(mergePreservedMeasurements({ chest: '40', 'field-a': '42' }, null,
    { chest: 'field-a' }, { 'field-a': '40' }), { chest: '40', 'field-a': '42' });
  assert.deepEqual(mergePreservedMeasurements(['unusual', 'legacy'], null, {}, null), ['unusual', 'legacy']);
  const original = JSON.parse('{"__proto__":"keep", "constructor":"also keep"}');
  const result = mergePreservedMeasurements(original, null, {}, null);
  assert.deepEqual(result, original);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});
