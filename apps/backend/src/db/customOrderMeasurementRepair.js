export const MEASUREMENT_RENAME_MIGRATION = '20260901120000_custom_order_fields_remove_key.js';
export const MEASUREMENT_REPAIR_ARCHIVE = 'custom_order_measurement_repair_archive';

function decode(value) {
  if (typeof value !== 'string') return value ?? null;
  try { return JSON.parse(value); } catch { return value; }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Original values remain recoverable in the archive, including unknown keys and staged conflicts. */
export function mergePreservedMeasurements(original, staged, fieldMap, current) {
  const source = decode(original);
  const previousStage = decode(staged);
  const migrated = decode(current);
  if (source !== null && !isRecord(source)) return source;
  if (source === null && previousStage !== null && !isRecord(previousStage)) return previousStage;
  const mapping = decode(fieldMap) || {};
  const result = new Map([
    ...Object.entries(isRecord(migrated) ? migrated : {}),
    ...Object.entries(isRecord(previousStage) ? previousStage : {}),
  ]);
  for (const [key, value] of Object.entries(source || {})) {
    const target = Object.hasOwn(mapping, key) ? String(mapping[key]) : key;
    if (target !== key && Object.hasOwn(source, target)) {
      result.set(key, value);
    } else {
      result.set(target, value);
    }
  }
  return source === null && previousStage === null && migrated === null ? null : Object.fromEntries(result);
}

/** Pre-create the staging column so the historical migration's captured flag is true. */
export async function prepareCustomOrderMeasurementRename(knex) {
  if (await knex.schema.hasTable('knex_migrations')) {
    const applied = await knex('knex_migrations').where({ name: MEASUREMENT_RENAME_MIGRATION }).first();
    if (applied) return;
  }
  if (!(await knex.schema.hasTable('custom_orders'))
    || !(await knex.schema.hasTable('custom_order_field_definitions'))) {
    throw new Error('Custom order tables must exist before repairing the measurement migration');
  }
  const hasSource = await knex.schema.hasColumn('custom_orders', 'measurements');
  const hasStage = await knex.schema.hasColumn('custom_orders', 'measurements_by_id');
  if (!hasSource && !hasStage) throw new Error('No recoverable custom order measurement column exists');

  if (!(await knex.schema.hasTable(MEASUREMENT_REPAIR_ARCHIVE))) {
    await knex.schema.createTable(MEASUREMENT_REPAIR_ARCHIVE, (table) => {
      table.uuid('order_id').primary();
      table.uuid('shop_id').notNullable();
      table.json('original_measurements').nullable();
      table.json('staged_measurements').nullable();
      table.json('field_key_map').notNullable();
      table.timestamp('restored_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }
  const definitions = await knex.schema.hasColumn('custom_order_field_definitions', 'field_key')
    ? await knex('custom_order_field_definitions').select('id', 'shop_id', 'field_key') : [];
  const mappings = new Map();
  for (const definition of definitions) {
    if (!definition.field_key) continue;
    if (!mappings.has(definition.shop_id)) mappings.set(definition.shop_id, Object.create(null));
    mappings.get(definition.shop_id)[definition.field_key] = definition.id;
  }
  const rows = await knex('custom_orders').select('id', 'shop_id',
    ...(hasSource ? ['measurements'] : []), ...(hasStage ? ['measurements_by_id'] : []));
  for (const row of rows) {
    await knex(MEASUREMENT_REPAIR_ARCHIVE).insert({
      order_id: row.id,
      shop_id: row.shop_id,
      original_measurements: row.measurements == null ? null : JSON.stringify(decode(row.measurements)),
      staged_measurements: row.measurements_by_id == null ? null : JSON.stringify(decode(row.measurements_by_id)),
      field_key_map: JSON.stringify(mappings.get(row.shop_id) || {}),
    }).onConflict('order_id').ignore();
  }
  if (!hasSource) await knex.schema.alterTable('custom_orders', (table) => table.json('measurements').nullable());
  if (!hasStage) await knex.schema.alterTable('custom_orders', (table) => table.json('measurements_by_id').nullable());
}

/** Only snapshots made before an unapplied historical migration can affect business rows. */
export async function restoreCustomOrderMeasurements(knex) {
  if (!(await knex.schema.hasTable(MEASUREMENT_REPAIR_ARCHIVE))) return;
  if (await knex.schema.hasColumn('custom_orders', 'measurements_by_id')) {
    throw new Error('Complete the custom order measurement rename before restoring archived values');
  }
  const snapshots = await knex(MEASUREMENT_REPAIR_ARCHIVE).whereNull('restored_at').select('*');
  for (const snapshot of snapshots) {
    await knex.transaction(async (trx) => {
      const saved = await trx(MEASUREMENT_REPAIR_ARCHIVE).where({ order_id: snapshot.order_id }).forUpdate().first();
      if (saved.restored_at) return;
      const row = await trx('custom_orders').where({ id: saved.order_id, shop_id: saved.shop_id }).forUpdate().first();
      if (row) {
        const restored = mergePreservedMeasurements(saved.original_measurements, saved.staged_measurements,
          saved.field_key_map, row.measurements);
        await trx('custom_orders').where({ id: row.id, shop_id: row.shop_id })
          .update({ measurements: restored === null ? null : JSON.stringify(restored) });
      }
      await trx(MEASUREMENT_REPAIR_ARCHIVE).where({ order_id: saved.order_id }).update({ restored_at: trx.fn.now() });
    });
  }
}
