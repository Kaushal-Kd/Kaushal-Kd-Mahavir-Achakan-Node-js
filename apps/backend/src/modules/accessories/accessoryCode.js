import { v4 as uuid } from 'uuid';

import {
  buildProductCode,
  normalizeProductCode,
  productCodeNumberFromStored,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { badRequest } from '../../utils/errors.js';

export const ACCESSORY_CODE_FORMAT_KEY = 'config.accessory_code';
const DEFAULT_CODE_FORMAT = { default_prefix: 'ACC', padding: 4, by_category: {} };

function normalizeCodeFormatPrefix(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase().slice(0, 40);
}

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
    Number.isInteger(stored?.padding) && stored.padding > 0
      ? stored.padding
      : DEFAULT_CODE_FORMAT.padding;
  const defaultPrefix =
    typeof stored?.default_prefix === 'string'
      ? stored.default_prefix
      : typeof stored?.prefix === 'string'
        ? stored.prefix
        : DEFAULT_CODE_FORMAT.default_prefix;
  const byCategoryRaw =
    stored?.by_category && typeof stored.by_category === 'object' ? stored.by_category : {};
  const by_category = {};
  for (const [catId, val] of Object.entries(byCategoryRaw)) {
    if (typeof val === 'string') by_category[String(catId)] = val.trim().slice(0, 40);
  }
  return {
    padding,
    default_prefix: defaultPrefix.trim().slice(0, 40),
    by_category,
  };
}

/** @param {ReturnType<typeof normalizeCodeFormatStored>} fmt */
export function resolveAccessoryCodePrefix(fmt, categoryId) {
  if (categoryId && fmt.by_category?.[categoryId]) {
    return fmt.by_category[categoryId];
  }
  return fmt.default_prefix || DEFAULT_CODE_FORMAT.default_prefix;
}

async function maxAccessoryCodeNumberForPrefix(shopId, prefix, padding) {
  const p = String(prefix ?? '').trim();
  if (!p) return 0;
  const rows = await knex('accessories')
    .where({ shop_id: shopId })
    .whereNotNull('code')
    .whereNot('code', '')
    .andWhere('code', 'like', `${p}%`)
    .select('code');
  let max = 0;
  for (const row of rows) {
    const n = productCodeNumberFromStored(row.code, p, padding);
    if (n > max) max = n;
  }
  return max;
}

function emptyCodeWhere(qb) {
  qb.where(function emptyCode() {
    this.whereNull('code').orWhere('code', '');
  });
}

async function accessoryCodeUniqueIndexExists() {
  const rows = await knex('INFORMATION_SCHEMA.STATISTICS')
    .where({
      TABLE_SCHEMA: knex.client.database(),
      TABLE_NAME: 'accessories',
      INDEX_NAME: 'accessories_shop_id_code_unique',
    })
    .select('INDEX_NAME')
    .limit(1);
  return rows.length > 0;
}

/** @returns {Promise<boolean>} */
export async function shopHasMissingAccessoryCodes(shopId) {
  const hasCode = await knex.schema.hasColumn('accessories', 'code');
  if (!hasCode) return true;
  const row = await knex('accessories')
    .where({ shop_id: shopId })
    .modify(emptyCodeWhere)
    .first('id');
  return Boolean(row);
}

/**
 * Assign codes to accessories that pre-date code restore / missed migration backfill.
 * @returns {Promise<number>} rows updated
 */
export async function backfillMissingAccessoryCodes(shopId) {
  const hasCode = await knex.schema.hasColumn('accessories', 'code');
  if (!hasCode) return 0;

  const fmt = await getAccessoryCodeFormat(shopId);
  const rows = await knex('accessories')
    .where({ shop_id: shopId })
    .modify(emptyCodeWhere)
    .orderBy('category_id', 'asc')
    .orderBy('created_at', 'asc')
    .select('id', 'category_id');

  if (!rows.length) return 0;

  const nextByKey = new Map();
  let updated = 0;

  for (const row of rows) {
    const categoryId = row.category_id || null;
    const prefix = resolveAccessoryCodePrefix(fmt, categoryId);
    const key = prefix;
    let next = nextByKey.get(key);
    if (next == null) {
      const max = await maxAccessoryCodeNumberForPrefix(shopId, prefix, fmt.padding);
      next = max + 1;
    }
    const code = normalizeProductCode(buildProductCode(prefix, next, fmt.padding, ''));
    await knex('accessories').where({ id: row.id }).update({ code, updated_at: knex.fn.now() });
    nextByKey.set(key, next + 1);
    updated += 1;
  }

  return updated;
}

async function shopDuplicateAccessoryCodes(shopId) {
  return knex('accessories')
    .where({ shop_id: shopId })
    .whereNotNull('code')
    .whereNot('code', '')
    .groupBy('code')
    .havingRaw('COUNT(*) > 1')
    .pluck('code');
}

/**
 * Reassign codes when duplicate (shop_id, code) pairs exist after partial backfill.
 */
async function repairDuplicateAccessoryCodes(shopId) {
  let repaired = 0;
  for (let pass = 0; pass < 50; pass += 1) {
    const dupCodes = await shopDuplicateAccessoryCodes(shopId);
    if (!dupCodes.length) break;

    for (const code of dupCodes) {
      const rows = await knex('accessories')
        .where({ shop_id: shopId, code })
        .orderBy('created_at', 'asc')
        .select('id', 'category_id');
      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        const generated = await generateNextAccessoryCode(shopId, row.category_id || null);
        await knex('accessories')
          .where({ id: row.id })
          .update({ code: generated.code, updated_at: knex.fn.now() });
        repaired += 1;
      }
    }
  }
  return repaired;
}

async function globalHasDuplicateAccessoryCodes() {
  const row = await knex('accessories')
    .whereNotNull('code')
    .whereNot('code', '')
    .groupBy('shop_id', 'code')
    .havingRaw('COUNT(*) > 1')
    .first(knex.raw('1 as found'));
  return Boolean(row);
}

async function repairAllDuplicateAccessoryCodes() {
  const shops = await knex('accessories').distinct('shop_id').pluck('shop_id');
  let repaired = 0;
  for (const shopId of shops) {
    repaired += await repairDuplicateAccessoryCodes(shopId);
  }
  return repaired;
}

async function ensureAccessoryCodeUniqueIndex() {
  if (await accessoryCodeUniqueIndexExists()) return false;

  await repairAllDuplicateAccessoryCodes();

  const anyEmpty = await knex('accessories').modify(emptyCodeWhere).first('id');
  if (anyEmpty || (await globalHasDuplicateAccessoryCodes())) return false;

  await knex.schema.alterTable('accessories', (t) => {
    t.unique(['shop_id', 'code'], { indexName: 'accessories_shop_id_code_unique' });
  });
  return true;
}

/**
 * Add `accessories.code` when migration history was stamped without applying schema,
 * backfill existing rows, then enforce NOT NULL + unique index when complete.
 */
export async function ensureAccessoryCodesReady(shopId) {
  let hasCode = await knex.schema.hasColumn('accessories', 'code');
  if (!hasCode) {
    await knex.schema.alterTable('accessories', (t) => {
      t.string('code', 80).nullable();
    });
    hasCode = true;
  }

  const updated = await backfillMissingAccessoryCodes(shopId);
  await repairDuplicateAccessoryCodes(shopId);

  const anyShopMissing = await knex('accessories').modify(emptyCodeWhere).first('id');
  if (!anyShopMissing && hasCode) {
    try {
      await knex.schema.alterTable('accessories', (t) => {
        t.string('code', 80).notNullable().alter();
      });
    } catch {
      /* column may already be NOT NULL */
    }
    try {
      await ensureAccessoryCodeUniqueIndex();
    } catch {
      await repairAllDuplicateAccessoryCodes();
      await ensureAccessoryCodeUniqueIndex();
    }
  }

  return updated;
}

async function fetchAccessoryCodeWithNumber(shopId, categoryId, prefix, padding, targetNumber) {
  const num = Math.floor(Number(targetNumber) || 0);
  const p = String(prefix ?? '').trim();
  if (!p || num <= 0) return null;

  const rows = await knex('accessories')
    .where({ shop_id: shopId })
    .andWhere('code', 'like', `${p}%`)
    .select('code')
    .orderBy('created_at', 'desc');
  for (const row of rows) {
    if (productCodeNumberFromStored(row.code, p, padding) === num) {
      return normalizeProductCode(row.code);
    }
  }
  return null;
}

async function findAccessoryCodeNumberConflict(
  shopId,
  { prefix, padding, number, categoryId, excludeAccessoryId }
) {
  const num = Math.floor(Number(number));
  const p = String(prefix ?? '').trim();
  if (!Number.isFinite(num) || num <= 0 || !p) return null;

  let qb = knex('accessories').where({ shop_id: shopId }).andWhere('code', 'like', `${p}%`);
  if (excludeAccessoryId) qb = qb.whereNot({ id: excludeAccessoryId });

  const rows = await qb.select('id', 'code');
  for (const row of rows) {
    const stored = productCodeNumberFromStored(row.code, p, padding);
    if (stored === num) {
      return {
        number: num,
        existing_code: normalizeProductCode(row.code),
        accessory_id: row.id,
      };
    }
  }
  return null;
}

async function resolveNextAvailableAccessoryCodeNumber(shopId, prefix, padding, categoryId) {
  const max = await maxAccessoryCodeNumberForPrefix(shopId, prefix, padding);
  let next = Math.max(0, max) + 1;
  while (
    await findAccessoryCodeNumberConflict(shopId, {
      prefix,
      padding,
      number: next,
      categoryId,
    })
  ) {
    next += 1;
  }
  return { max, next };
}

export async function assertAccessoryCodeNumberAvailable(shopId, data, excludeAccessoryId = null) {
  const fmt = await getAccessoryCodeFormat(shopId);
  const categoryId = data.category_id || null;
  const prefix = resolveAccessoryCodePrefix(fmt, categoryId);
  if (!prefix) return;
  const padding = fmt.padding;
  const code = normalizeProductCode(data.code || '');
  const number = productCodeNumberFromStored(code, prefix, padding);
  if (!number) return;

  const conflict = await findAccessoryCodeNumberConflict(shopId, {
    prefix,
    padding,
    number,
    categoryId,
    excludeAccessoryId,
  });
  if (conflict) {
    throw badRequest(`Accessory number ${number} already exists.`);
  }
}

export async function getAccessoryCodeFormat(shopId) {
  const row = await knex('settings')
    .where({ shop_id: shopId, key: ACCESSORY_CODE_FORMAT_KEY })
    .first();
  const stored = parseJSONSafe(row?.value);
  const fmt = normalizeCodeFormatStored(stored || {});
  return { ...fmt, is_custom: !!stored };
}

export async function updateAccessoryCodeFormat(shopId, data) {
  const byCategoryIn = data?.by_category && typeof data.by_category === 'object' ? data.by_category : {};
  const by_category = {};
  for (const [catId, val] of Object.entries(byCategoryIn)) {
    by_category[String(catId)] = normalizeCodeFormatPrefix(val);
  }
  const payload = {
    default_prefix: normalizeCodeFormatPrefix(data?.default_prefix ?? DEFAULT_CODE_FORMAT.default_prefix),
    padding: Math.max(1, Math.min(10, Number(data?.padding) || DEFAULT_CODE_FORMAT.padding)),
    by_category,
  };
  const existing = await knex('settings')
    .where({ shop_id: shopId, key: ACCESSORY_CODE_FORMAT_KEY })
    .first();
  const rowPayload = { value: JSON.stringify(payload), updated_at: knex.fn.now() };
  if (existing) {
    await knex('settings').where({ id: existing.id }).update(rowPayload);
  } else {
    await knex('settings').insert({
      id: uuid(),
      shop_id: shopId,
      key: ACCESSORY_CODE_FORMAT_KEY,
      ...rowPayload,
    });
  }
  return { ...payload, is_custom: true };
}

export async function getLastAccessoryCodeForCategory(shopId, categoryId) {
  if (!categoryId) {
    return { code: null, max_number: null, prefix: '', padding: 4, next_number: null };
  }
  const fmt = await getAccessoryCodeFormat(shopId);
  const prefix = resolveAccessoryCodePrefix(fmt, categoryId);
  const padding = fmt.padding;

  if (!prefix) {
    return { code: null, max_number: null, prefix: '', padding, next_number: null };
  }

  const { max, next } = await resolveNextAvailableAccessoryCodeNumber(
    shopId,
    prefix,
    padding,
    categoryId
  );
  const code =
    max > 0 ? await fetchAccessoryCodeWithNumber(shopId, categoryId, prefix, padding, max) : null;

  return { code, max_number: max || null, prefix, padding, next_number: next };
}

export async function generateNextAccessoryCode(shopId, categoryId = null) {
  const fmt = await getAccessoryCodeFormat(shopId);
  const prefix = resolveAccessoryCodePrefix(fmt, categoryId);
  const padding = fmt.padding;

  if (categoryId && !prefix) {
    throw badRequest(
      'Configure a prefix for this category in Code format (Configuration → Code format).'
    );
  }

  const { next } = await resolveNextAvailableAccessoryCodeNumber(
    shopId,
    prefix,
    padding,
    categoryId
  );
  const code = normalizeProductCode(buildProductCode(prefix, next, padding, ''));

  return { code, prefix, padding, next_number: next };
}

export function normalizeAccessoryCodeInput(code) {
  return normalizeProductCode(String(code || '').trim());
}
