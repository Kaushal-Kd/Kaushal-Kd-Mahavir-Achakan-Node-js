import {
  buildProductCode,
  normalizeProductCode,
  productCodeNumberFromStored,
} from '@wrs/shared';

const ACCESSORY_CODE_FORMAT_KEY = 'config.accessory_code';
const FALLBACK_PREFIX = 'ACC';
const DEFAULT_PADDING = 4;

function parseJSONSafe(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeCodeFormatStored(stored) {
  const padding =
    Number.isInteger(stored?.padding) && stored.padding > 0 ? stored.padding : DEFAULT_PADDING;
  const defaultPrefix =
    typeof stored?.default_prefix === 'string' && stored.default_prefix.trim()
      ? stored.default_prefix.trim()
      : FALLBACK_PREFIX;
  const byCategoryRaw =
    stored?.by_category && typeof stored.by_category === 'object' ? stored.by_category : {};
  const by_category = {};
  for (const [catId, val] of Object.entries(byCategoryRaw)) {
    if (typeof val === 'string' && val.trim()) by_category[String(catId)] = val.trim().slice(0, 40);
  }
  return { padding, default_prefix: defaultPrefix.slice(0, 40), by_category };
}

function resolvePrefix(fmt, categoryId) {
  if (categoryId && fmt.by_category?.[categoryId]) return fmt.by_category[categoryId];
  return fmt.default_prefix || FALLBACK_PREFIX;
}

async function maxNumberForPrefix(knex, shopId, prefix, padding, categoryId) {
  let qb = knex('accessories')
    .where({ shop_id: shopId })
    .whereNotNull('code')
    .andWhere('code', 'like', `${prefix}%`);
  if (categoryId) qb = qb.andWhere({ category_id: categoryId });
  const rows = await qb.select('code');
  let max = 0;
  for (const row of rows) {
    const n = productCodeNumberFromStored(row.code, prefix, padding);
    if (n > max) max = n;
  }
  return max;
}

async function backfillShopCodes(knex, shopId) {
  const setting = await knex('settings')
    .where({ shop_id: shopId, key: ACCESSORY_CODE_FORMAT_KEY })
    .first('value');
  const fmt = normalizeCodeFormatStored(parseJSONSafe(setting?.value) || {});

  const rows = await knex('accessories')
    .where({ shop_id: shopId })
    .where(function emptyCode() {
      this.whereNull('code').orWhere('code', '');
    })
    .orderBy('category_id', 'asc')
    .orderBy('created_at', 'asc')
    .select('id', 'category_id');

  const nextByKey = new Map();

  for (const row of rows) {
    const categoryId = row.category_id || null;
    const prefix = resolvePrefix(fmt, categoryId);
    const key = `${prefix}::${categoryId || ''}`;
    let next = nextByKey.get(key);
    if (next == null) {
      const max = await maxNumberForPrefix(knex, shopId, prefix, fmt.padding, categoryId);
      next = max + 1;
    }
    const code = normalizeProductCode(buildProductCode(prefix, next, fmt.padding, ''));
    await knex('accessories').where({ id: row.id }).update({ code });
    nextByKey.set(key, next + 1);
  }
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasCode = await knex.schema.hasColumn('accessories', 'code');
  if (!hasCode) {
    await knex.schema.alterTable('accessories', (t) => {
      t.string('code', 80).nullable();
    });
  }

  const shops = await knex('accessories').distinct('shop_id').pluck('shop_id');
  for (const shopId of shops) {
    await backfillShopCodes(knex, shopId);
  }

  const remaining = await knex('accessories')
    .where(function emptyCode() {
      this.whereNull('code').orWhere('code', '');
    })
    .orderBy('shop_id')
    .orderBy('created_at', 'asc')
    .select('id', 'shop_id');

  const orphanNext = new Map();
  for (const row of remaining) {
    const fmt = normalizeCodeFormatStored(
      parseJSONSafe(
        (
          await knex('settings')
            .where({ shop_id: row.shop_id, key: ACCESSORY_CODE_FORMAT_KEY })
            .first('value')
        )?.value
      ) || {}
    );
    const prefix = fmt.default_prefix || FALLBACK_PREFIX;
    const key = `${row.shop_id}::${prefix}`;
    let next = orphanNext.get(key);
    if (next == null) {
      const max = await maxNumberForPrefix(knex, row.shop_id, prefix, fmt.padding, null);
      next = max + 1;
    }
    const code = normalizeProductCode(buildProductCode(prefix, next, fmt.padding, ''));
    await knex('accessories').where({ id: row.id }).update({ code });
    orphanNext.set(key, next + 1);
  }

  await knex.schema.alterTable('accessories', (t) => {
    t.string('code', 80).notNullable().alter();
  });

  const hasIndex = await knex.schema.hasTable('accessories');
  if (hasIndex) {
    const rows = await knex('INFORMATION_SCHEMA.STATISTICS')
      .where({
        TABLE_SCHEMA: knex.client.database(),
        TABLE_NAME: 'accessories',
        INDEX_NAME: 'accessories_shop_id_code_unique',
      })
      .select('INDEX_NAME')
      .limit(1);
    if (!rows.length) {
      await knex.schema.alterTable('accessories', (t) => {
        t.unique(['shop_id', 'code'], { indexName: 'accessories_shop_id_code_unique' });
      });
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasCode = await knex.schema.hasColumn('accessories', 'code');
  if (!hasCode) return;

  const rows = await knex('INFORMATION_SCHEMA.STATISTICS')
    .where({
      TABLE_SCHEMA: knex.client.database(),
      TABLE_NAME: 'accessories',
      INDEX_NAME: 'accessories_shop_id_code_unique',
    })
    .select('INDEX_NAME')
    .limit(1);
  if (rows.length) {
    await knex.schema.alterTable('accessories', (t) => {
      t.dropUnique(['shop_id', 'code'], 'accessories_shop_id_code_unique');
    });
  }

  await knex.schema.alterTable('accessories', (t) => {
    t.dropColumn('code');
  });
}
