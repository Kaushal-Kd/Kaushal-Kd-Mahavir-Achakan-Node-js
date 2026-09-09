/**
 * Indexed STORED columns mirroring stage_flags JSON paths for faster item-stage filters.
 */

const FLAG_DEFS = [
  ['sf_item_to_collect', '$.item_to_collect'],
  ['sf_pre_check', '$.pre_check'],
  ['sf_prepared', '$.prepared'],
  ['sf_delivered', '$.delivered'],
  ['sf_received', '$.received'],
];

function truthyExpr(path) {
  const extract = `JSON_EXTRACT(stage_flags, '${path}')`;
  const unquoted = `JSON_UNQUOTE(${extract})`;
  return `(
    ${extract} = CAST('true' AS JSON)
    OR ${extract} = CAST('1' AS JSON)
    OR ${unquoted} IN ('true', '1')
  )`;
}

export async function up(knex) {
  for (const [col, path] of FLAG_DEFS) {
    const hasCol = await knex.schema.hasColumn('order_items', col);
    if (hasCol) continue;
    await knex.schema.raw(`
      ALTER TABLE order_items
      ADD COLUMN ${col} TINYINT(1) GENERATED ALWAYS AS (
        CASE WHEN ${truthyExpr(path)} THEN 1 ELSE 0 END
      ) STORED
    `);
  }

  await knex.schema.raw(`
    CREATE INDEX idx_oi_shop_stage_collect_pending
    ON order_items (shop_id, sf_item_to_collect, sf_pre_check, sf_prepared, sf_delivered, sf_received)
  `);
}

export async function down(knex) {
  await knex.schema.raw('DROP INDEX idx_oi_shop_stage_collect_pending ON order_items');
  for (const [col] of [...FLAG_DEFS].reverse()) {
    const hasCol = await knex.schema.hasColumn('order_items', col);
    if (!hasCol) continue;
    await knex.schema.raw(`ALTER TABLE order_items DROP COLUMN ${col}`);
  }
}
