import { naturalSortKey } from '@wrs/shared';

/**
 * A-659[38] -> A-0659[38]. Leaves 2-digit and 4-digit codes unchanged.
 * @param {unknown} code
 * @returns {string|null}
 */
export function padThreeDigitProductCode(code) {
  const match = String(code ?? '')
    .trim()
    .match(/^([A-Za-z]+-)(\d+)(\[[^\]]*\])?$/);
  if (!match || match[2].length !== 3) return null;
  return `${match[1]}0${match[2]}${match[3] || ''}`;
}

/**
 * @param {import('knex').Knex} knex
 * @param {string} shopId
 */
async function padCodesForShop(knex, shopId) {
  const rows = await knex('products').where({ shop_id: shopId }).select('id', 'code');
  const existing = new Set(rows.map((row) => row.code));
  const hasSortKey = await knex.schema.hasColumn('products', 'natural_code_sort_key');

  for (const row of rows) {
    const next = padThreeDigitProductCode(row.code);
    if (!next || next === row.code) continue;
    if (existing.has(next)) continue;

    const patch = { code: next, updated_at: knex.fn.now() };
    if (hasSortKey) patch.natural_code_sort_key = naturalSortKey(next);

    await knex('products').where({ id: row.id }).update(patch);
    existing.delete(row.code);
    existing.add(next);
  }
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('products').distinct('shop_id');
  for (const { shop_id: shopId } of shops) {
    if (shopId) await padCodesForShop(knex, shopId);
  }

  if (await knex.schema.hasTable('order_items')) {
    await knex.raw(`
      UPDATE order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      SET oi.code_snapshot = p.code
      WHERE oi.product_id IS NOT NULL
        AND p.code IS NOT NULL
        AND TRIM(p.code) <> ''
    `);
  }

  if (await knex.schema.hasTable('washing_queue')) {
    await knex.raw(`
      UPDATE washing_queue w
      INNER JOIN products p ON p.id = w.product_id
      SET w.product_code = p.code
      WHERE w.product_id IS NOT NULL
        AND p.code IS NOT NULL
        AND TRIM(p.code) <> ''
    `);
  }

  if (await knex.schema.hasTable('laundry_job_products')) {
    await knex.raw(`
      UPDATE laundry_job_products lp
      INNER JOIN products p ON p.id = lp.product_id
      SET lp.product_code = p.code
      WHERE lp.product_id IS NOT NULL
        AND p.code IS NOT NULL
        AND TRIM(p.code) <> ''
    `);
  }
}

/** @param {import('knex').Knex} knex */
export async function down() {
  // Cannot tell originally-4-digit codes (A-0657) from padded 3-digit codes.
}
