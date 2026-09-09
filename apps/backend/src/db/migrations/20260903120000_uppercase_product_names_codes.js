import { normalizeProductCode, normalizeProductName } from '@wrs/shared';

const CODE_FORMAT_KEY = 'config.product_code';

/**
 * Per shop: uppercase products while avoiding unique (shop_id, code) collisions.
 * @param {import('knex').Knex} knex
 * @param {string} shopId
 */
async function uppercaseProductsForShop(knex, shopId) {
  const rows = await knex('products')
    .where({ shop_id: shopId })
    .select('id', 'name', 'code', 'created_at')
    .orderBy('created_at', 'asc');

  /** @type {Map<string, string>} normalized code -> earliest product id */
  const ownerByCode = new Map();

  for (const row of rows) {
    const nextCode = normalizeProductCode(row.code);
    const nextName = normalizeProductName(row.name);
    if (!nextCode) continue;

    const ownerId = ownerByCode.get(nextCode);
    if (ownerId && ownerId !== row.id) continue;

    const patch = { updated_at: knex.fn.now() };
    if (nextName && nextName !== row.name) patch.name = nextName;
    if (nextCode !== row.code) patch.code = nextCode;

    if (Object.keys(patch).length > 1) {
      await knex('products').where({ id: row.id }).update(patch);
    }

    if (!ownerByCode.has(nextCode)) ownerByCode.set(nextCode, row.id);
  }
}

function normalizeCodeFormatPrefix(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase().slice(0, 40);
}

/** @param {import('knex').Knex} knex */
async function bulkUppercaseSnapshotColumns(knex) {
  const hasWashing = await knex.schema.hasTable('washing_queue');
  if (hasWashing) {
    await knex.raw(`
      UPDATE washing_queue
      SET product_name = UPPER(TRIM(product_name)),
          product_code = UPPER(REPLACE(product_code, ' ', ''))
      WHERE (product_name IS NOT NULL AND TRIM(product_name) <> '')
         OR (product_code IS NOT NULL AND TRIM(product_code) <> '')
    `);
  }

  const hasLaundry = await knex.schema.hasTable('laundry_job_products');
  if (hasLaundry) {
    await knex.raw(`
      UPDATE laundry_job_products
      SET product_name = UPPER(TRIM(product_name)),
          product_code = UPPER(REPLACE(product_code, ' ', ''))
      WHERE (product_name IS NOT NULL AND TRIM(product_name) <> '')
         OR (product_code IS NOT NULL AND TRIM(product_code) <> '')
    `);
  }
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('products').distinct('shop_id');
  for (const { shop_id: shopId } of shops) {
    if (shopId) await uppercaseProductsForShop(knex, shopId);
  }

  await bulkUppercaseSnapshotColumns(knex);

  const settingsRows = await knex('settings').where({ key: CODE_FORMAT_KEY }).select('id', 'value');
  for (const row of settingsRows) {
    let parsed;
    try {
      parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;

    const byCategoryIn =
      parsed.by_category && typeof parsed.by_category === 'object' ? parsed.by_category : {};
    const by_category = {};
    for (const [catId, val] of Object.entries(byCategoryIn)) {
      by_category[String(catId)] = normalizeCodeFormatPrefix(val);
    }

    const next = {
      ...parsed,
      default_prefix: normalizeCodeFormatPrefix(parsed.default_prefix ?? parsed.prefix ?? ''),
      by_category,
    };

    await knex('settings')
      .where({ id: row.id })
      .update({ value: JSON.stringify(next), updated_at: knex.fn.now() });
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
  }
}

/** @param {import('knex').Knex} knex */
export async function down() {
  // Cannot restore original letter casing.
}
