/**
 * Remove custom order field_key usage.
 *
 * - custom_order_field_definitions: drop field_key, replace uniqueness with (shop_id, label)
 * - custom_orders.measurements: migrate from { field_key: value } → { field_definition_id: value }
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // 1) Add new measurements column for migration.
  const hasMeasurementsById = await knex.schema.hasColumn('custom_orders', 'measurements_by_id');
  if (!hasMeasurementsById) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.json('measurements_by_id').nullable();
    });
  }

  // 2) Migrate row data in Node (safe for small/medium data volumes).
  const hasFieldKey = await knex.schema.hasColumn('custom_order_field_definitions', 'field_key');
  if (hasFieldKey) {
    const defs = await knex('custom_order_field_definitions')
      .select('id', 'shop_id', 'field_key')
      .whereNotNull('field_key');

    const byShopAndKey = new Map();
    for (const d of defs) {
      const shopId = String(d.shop_id);
      const k = String(d.field_key || '').trim();
      if (!k) continue;
      const key = `${shopId}::${k}`;
      byShopAndKey.set(key, String(d.id));
    }

    const rows = await knex('custom_orders')
      .select('id', 'shop_id', 'measurements')
      .whereNotNull('measurements');

    for (const r of rows) {
      let raw = r.measurements;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

      const shopId = String(r.shop_id);
      const next = {};
      for (const [k, v] of Object.entries(raw)) {
        const fieldId = byShopAndKey.get(`${shopId}::${String(k)}`) || null;
        if (!fieldId) continue;
        const s = v == null ? '' : String(v).trim();
        if (!s) continue;
        next[fieldId] = s;
      }

      await knex('custom_orders')
        .where({ id: r.id })
        .update({ measurements_by_id: JSON.stringify(next), updated_at: knex.fn.now() });
    }
  }

  // 3) Replace measurements column.
  const hasOldMeasurements = await knex.schema.hasColumn('custom_orders', 'measurements');
  if (hasOldMeasurements && hasMeasurementsById) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('measurements');
    });
  }
  if (await knex.schema.hasColumn('custom_orders', 'measurements_by_id')) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.renameColumn('measurements_by_id', 'measurements');
    });
  }

  // 4) Drop field_key and old uniqueness, replace with label uniqueness.
  if (hasFieldKey) {
    // Best-effort drop unique index (name varies across MySQL setups).
    try {
      await knex.schema.alterTable('custom_order_field_definitions', (t) => {
        t.dropUnique(['shop_id', 'field_key']);
      });
    } catch {
      /* ignore */
    }

    await knex.schema.alterTable('custom_order_field_definitions', (t) => {
      t.dropColumn('field_key');
    });
  }

  // Ensure label uniqueness per shop (prevents duplicates in the form).
  try {
    await knex.schema.alterTable('custom_order_field_definitions', (t) => {
      t.unique(['shop_id', 'label']);
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  // Recreate field_key and attempt to move measurements back by label (best-effort).
  const hasFieldKey = await knex.schema.hasColumn('custom_order_field_definitions', 'field_key');
  if (!hasFieldKey) {
    await knex.schema.alterTable('custom_order_field_definitions', (t) => {
      t.string('field_key', 64).nullable();
    });
  }

  const hasMeasurementsByKey = await knex.schema.hasColumn('custom_orders', 'measurements_by_key');
  if (!hasMeasurementsByKey) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.json('measurements_by_key').nullable();
    });
  }

  const defs = await knex('custom_order_field_definitions').select('id', 'shop_id', 'field_key');
  const byShopAndId = new Map();
  for (const d of defs) {
    byShopAndId.set(`${String(d.shop_id)}::${String(d.id)}`, String(d.field_key || ''));
  }

  const rows = await knex('custom_orders')
    .select('id', 'shop_id', 'measurements')
    .whereNotNull('measurements');

  for (const r of rows) {
    let raw = r.measurements;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const shopId = String(r.shop_id);
    const next = {};
    for (const [id, v] of Object.entries(raw)) {
      const key = byShopAndId.get(`${shopId}::${String(id)}`) || '';
      if (!key) continue;
      const s = v == null ? '' : String(v).trim();
      if (!s) continue;
      next[key] = s;
    }

    await knex('custom_orders')
      .where({ id: r.id })
      .update({ measurements_by_key: JSON.stringify(next), updated_at: knex.fn.now() });
  }

  const hasOldMeasurements = await knex.schema.hasColumn('custom_orders', 'measurements');
  if (hasOldMeasurements) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('measurements');
    });
  }
  await knex.schema.alterTable('custom_orders', (t) => {
    t.renameColumn('measurements_by_key', 'measurements');
  });
}

