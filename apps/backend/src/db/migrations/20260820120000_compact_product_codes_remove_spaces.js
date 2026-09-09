import { normalizeProductCode } from '@wrs/shared';

/** @param {string|null|undefined} code */
function hasWhitespace(code) {
  return /\s/.test(String(code ?? ''));
}

/**
 * Per shop: compact codes (remove all whitespace). If two products would share the same
 * compact code, keep the earliest-created row and leave the other unchanged.
 *
 * @param {import('knex').Knex} knex
 * @param {string} shopId
 */
async function compactProductsForShop(knex, shopId) {
  const rows = await knex('products')
    .where({ shop_id: shopId })
    .select('id', 'code', 'created_at')
    .orderBy('created_at', 'asc');

  /** @type {Map<string, string>} compact -> product id */
  const ownerByCompact = new Map();

  for (const row of rows) {
    const compact = normalizeProductCode(row.code);
    if (!compact || !hasWhitespace(row.code)) {
      if (compact) ownerByCompact.set(compact, row.id);
    }
  }

  for (const row of rows) {
    if (!hasWhitespace(row.code)) continue;
    const compact = normalizeProductCode(row.code);
    if (!compact) continue;
    if (ownerByCompact.has(compact) && ownerByCompact.get(compact) !== row.id) {
      continue;
    }
    await knex('products').where({ id: row.id }).update({
      code: compact,
      updated_at: knex.fn.now(),
    });
    ownerByCompact.set(compact, row.id);
  }
}

/**
 * @param {import('knex').Knex} knex
 * @param {string} table
 * @param {string} column
 */
async function compactTextColumn(knex, table, column) {
  const hasTable = await knex.schema.hasTable(table);
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn(table, column);
  if (!hasColumn) return;

  await knex.raw(
    `UPDATE ?? SET ?? = REGEXP_REPLACE(TRIM(??), '[[:space:]]+', '')
     WHERE ?? IS NOT NULL AND TRIM(??) <> '' AND ?? REGEXP '[[:space:]]'`,
    [table, column, column, column, column, column]
  );
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('products').distinct('shop_id');
  for (const { shop_id: shopId } of shops) {
    if (shopId) await compactProductsForShop(knex, shopId);
  }

  const hasOrderItems = await knex.schema.hasTable('order_items');
  if (hasOrderItems) {
    await knex.raw(`
      UPDATE order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      SET oi.code_snapshot = p.code
      WHERE oi.product_id IS NOT NULL
        AND p.code IS NOT NULL
        AND TRIM(p.code) <> ''
    `);
    await compactTextColumn(knex, 'order_items', 'code_snapshot');
  }

  await compactTextColumn(knex, 'washing_queue', 'product_code');
  await compactTextColumn(knex, 'laundry_job_products', 'product_code');
}

/** @param {import('knex').Knex} knex */
export async function down() {
  // Cannot restore removed spaces.
}
