/** Coerce legacy string booleans in stage_flags JSON to real JSON booleans. */

const ACTIVE_ORDER_STATUSES = [
  'draft',
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
];

const PRODUCT_FLAG_KEYS = ['item_to_collect', 'pre_check', 'prepared', 'delivered', 'received'];
const ACCESSORY_FLAG_KEYS = ['prepared', 'delivered', 'received'];

/**
 * @param {import('knex').Knex} knex
 * @param {string} table
 * @param {string[]} keys
 */
async function coerceStringBooleansInTable(knex, table, keys) {
  const joinClause =
    table === 'order_items'
      ? `INNER JOIN \`orders\` AS o ON o.id = t.order_id`
      : `INNER JOIN \`orders\` AS o ON o.id = t.order_id`;

  for (const key of keys) {
    const path = `$.${key}`;
    await knex.raw(
      `
      UPDATE \`${table}\` AS t
      ${joinClause}
      SET t.stage_flags = JSON_SET(
        COALESCE(t.stage_flags, JSON_OBJECT()),
        ?,
        CASE JSON_UNQUOTE(JSON_EXTRACT(t.stage_flags, ?))
          WHEN 'true' THEN CAST('true' AS JSON)
          WHEN '1' THEN CAST('true' AS JSON)
          ELSE CAST('false' AS JSON)
        END
      )
      WHERE t.stage_flags IS NOT NULL
        AND o.status IN (${ACTIVE_ORDER_STATUSES.map(() => '?').join(', ')})
        AND JSON_TYPE(JSON_EXTRACT(t.stage_flags, ?)) = 'STRING'
        AND JSON_UNQUOTE(JSON_EXTRACT(t.stage_flags, ?)) IN ('false', 'true', '0', '1')
      `,
      [path, path, ...ACTIVE_ORDER_STATUSES, path, path]
    );
  }
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await coerceStringBooleansInTable(knex, 'order_items', PRODUCT_FLAG_KEYS);
  await coerceStringBooleansInTable(knex, 'order_accessories', ACCESSORY_FLAG_KEYS);
}

/** @param {import('knex').Knex} knex */
export async function down() {
  // Irreversible data normalization.
}
