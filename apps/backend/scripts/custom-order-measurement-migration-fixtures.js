import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  MEASUREMENT_RENAME_MIGRATION,
  MEASUREMENT_REPAIR_ARCHIVE,
  prepareCustomOrderMeasurementRename,
  restoreCustomOrderMeasurements,
} from '../src/db/customOrderMeasurementRepair.js';
import { up as historicalMigration } from '../src/db/migrations/20260901120000_custom_order_fields_remove_key.js';

/** Exercise the unchanged migration on isolated tables inside the disposable MySQL database. */
export async function runCustomOrderMeasurementMigrationFixtures({ db }) {
  assert.match(String(db.client.config.connection.database || ''), /(test|disposable|temporary|tmp)/i);
  assert.equal(process.env.WRS_TEST_MYSQL_INTEGRATION, '1');
  const decode = (value) => typeof value === 'string' ? JSON.parse(value) : value;
  for (const partialStage of [false, true]) {
    const prefix = `repair_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const names = {
      knex_migrations: `${prefix}_m`, custom_orders: `${prefix}_o`,
      custom_order_field_definitions: `${prefix}_d`, [MEASUREMENT_REPAIR_ARCHIVE]: `${prefix}_a`,
    };
    const tableName = (name) => {
      assert.ok(names[name], `Unexpected fixture table: ${name}`);
      return names[name];
    };
    const scoped = (connection) => {
      const query = (name) => connection(tableName(name));
      query.fn = connection.fn;
      query.schema = Object.fromEntries(['hasTable', 'hasColumn', 'createTable', 'alterTable'].map((method) =>
        [method, (name, ...args) => connection.schema[method](tableName(name), ...args)]));
      query.transaction = (callback) => connection.transaction((trx) => callback(scoped(trx)));
      return query;
    };
    const fixtureDb = scoped(db);
    try {
      await db.schema.createTable(names.knex_migrations, (table) => table.string('name', 255));
      await db.schema.createTable(names.custom_order_field_definitions, (table) => {
        table.string('id', 36).primary(); table.string('shop_id', 36);
        table.string('field_key', 64); table.string('label', 120);
        table.unique(['shop_id', 'field_key']);
      });
      await db.schema.createTable(names.custom_orders, (table) => {
        table.string('id', 36).primary(); table.string('shop_id', 36);
        table.json('measurements'); table.timestamp('updated_at').nullable();
        if (partialStage) table.json('measurements_by_id');
      });
      await db(names.custom_order_field_definitions).insert([
        { id: 'field-a', shop_id: 'shop-a', field_key: 'chest', label: 'Chest' },
        { id: 'field-b', shop_id: 'shop-b', field_key: 'chest', label: 'Chest' },
      ]);
      const original = { chest: 40, unknown: 'Preserve me', blank: '', nullable: null };
      await db(names.custom_orders).insert([
        { id: 'order-a', shop_id: 'shop-a', measurements: JSON.stringify(original),
          ...(partialStage ? { measurements_by_id: JSON.stringify({ staged_extra: 'Keep stage' }) } : {}) },
        { id: 'order-b', shop_id: 'shop-b', measurements: JSON.stringify({ chest: '42' }) },
      ]);
      await prepareCustomOrderMeasurementRename(fixtureDb);
      await prepareCustomOrderMeasurementRename(fixtureDb);
      await historicalMigration(fixtureDb);
      await restoreCustomOrderMeasurements(fixtureDb);
      const a = await db(names.custom_orders).where({ id: 'order-a' }).first();
      const b = await db(names.custom_orders).where({ id: 'order-b' }).first();
      assert.deepEqual(decode(a.measurements), { 'field-a': 40, unknown: 'Preserve me', blank: '', nullable: null,
        ...(partialStage ? { staged_extra: 'Keep stage' } : {}) });
      assert.deepEqual(decode(b.measurements), { 'field-b': '42' });
      const backup = await db(names[MEASUREMENT_REPAIR_ARCHIVE]).where({ order_id: 'order-a' }).first();
      assert.deepEqual(decode(backup.original_measurements), original);
      assert.equal(await db.schema.hasColumn(names.custom_orders, 'measurements_by_id'), false);
      await db(names.knex_migrations).insert({ name: MEASUREMENT_RENAME_MIGRATION });
      await db(names.custom_orders).where({ id: 'order-a' }).update({ measurements: JSON.stringify({ 'field-a': 'later edit' }) });
      await prepareCustomOrderMeasurementRename(fixtureDb);
      await restoreCustomOrderMeasurements(fixtureDb);
      assert.deepEqual(decode((await db(names.custom_orders).where({ id: 'order-a' }).first()).measurements), { 'field-a': 'later edit' });
    } finally {
      for (const name of Object.values(names).reverse()) await db.schema.dropTableIfExists(name);
    }
  }
}
