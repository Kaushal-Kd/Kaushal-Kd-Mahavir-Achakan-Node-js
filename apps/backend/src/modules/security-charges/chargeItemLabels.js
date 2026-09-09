import knex from '../../db/knex.js';

function pickLabel(...parts) {
  for (const p of parts) {
    const t = String(p ?? '').trim();
    if (t) return t;
  }
  return '';
}

/**
 * Human-readable label for a checklist line linked to a security charge.
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 */
export async function resolveChargeItemLabel(db, shopId, itemType, itemId) {
  if (!itemId || !itemType) return null;

  if (itemType === 'accessory') {
    const row = await db('order_accessories as oa')
      .leftJoin('accessories as a', function joinA() {
        this.on('a.id', '=', 'oa.accessory_id').andOn('a.shop_id', '=', 'oa.shop_id');
      })
      .leftJoin('categories as cat', 'cat.id', 'a.category_id')
      .where({ 'oa.shop_id': shopId, 'oa.id': itemId })
      .select('oa.name_snapshot', 'a.name as accessory_name', 'cat.label as category_name')
      .first();
    if (!row) return 'Accessory';
    return pickLabel(row.name_snapshot, row.accessory_name, row.category_name) || 'Accessory';
  }

  if (itemType === 'item') {
    const row = await db('order_items as oi')
      .leftJoin('products as p', function joinP() {
        this.on('p.id', '=', 'oi.product_id').andOn('p.shop_id', '=', 'oi.shop_id');
      })
      .where({ 'oi.shop_id': shopId, 'oi.id': itemId })
      .select('oi.name_snapshot', 'oi.code_snapshot', 'p.name as product_name')
      .first();
    if (!row) return 'Item';
    return pickLabel(row.name_snapshot, row.product_name, row.code_snapshot) || 'Item';
  }

  return null;
}

const TYPE_PREFIX = {
  item: 'Item',
  accessory: 'Accessory',
};

/**
 * @param {string|null|undefined} remarks
 * @param {string|null|undefined} itemType
 * @param {string|null|undefined} label
 */
export function formatChecklistChargeRemarks(remarks, itemType, label, conditionKind = null) {
  const name = String(label || '').trim();
  if (!name || !itemType) return remarks || null;

  const raw = String(remarks || '').trim();
  if (raw.startsWith('Backfill')) return `Backfill · ${name}`;
  const kind = String(conditionKind || '').toLowerCase();
  if (!kind) {
    return raw || `Damage/missing · ${TYPE_PREFIX[itemType] || String(itemType)}: ${name}`;
  }
  const prefix = kind === 'missing' ? 'Missing' : 'Damage';
  return `${prefix} · ${name}`;
}

/**
 * Batch-load labels for security charge rows that reference checklist lines.
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} shopId
 * @param {Array<{ item_type?: string|null, item_id?: string|null }>} charges
 * @returns {Promise<Map<string, string>>} keys `${itemType}:${itemId}`
 */
export async function loadChargeItemLabelsMap(db, shopId, charges) {
  const map = new Map();
  const list = Array.isArray(charges) ? charges : [];
  const itemIds = [
    ...new Set(list.filter((c) => c.item_type === 'item' && c.item_id).map((c) => c.item_id)),
  ];
  const accessoryIds = [
    ...new Set(list.filter((c) => c.item_type === 'accessory' && c.item_id).map((c) => c.item_id)),
  ];

  if (itemIds.length) {
    const rows = await db('order_items as oi')
      .leftJoin('products as p', function joinP() {
        this.on('p.id', '=', 'oi.product_id').andOn('p.shop_id', '=', 'oi.shop_id');
      })
      .where({ 'oi.shop_id': shopId })
      .whereIn('oi.id', itemIds)
      .select('oi.id', 'oi.name_snapshot', 'oi.code_snapshot', 'p.name as product_name');
    for (const row of rows) {
      const label = pickLabel(row.name_snapshot, row.product_name, row.code_snapshot) || 'Item';
      map.set(`item:${row.id}`, label);
    }
  }

  if (accessoryIds.length) {
    const rows = await db('order_accessories as oa')
      .leftJoin('accessories as a', function joinA() {
        this.on('a.id', '=', 'oa.accessory_id').andOn('a.shop_id', '=', 'oa.shop_id');
      })
      .leftJoin('categories as cat', 'cat.id', 'a.category_id')
      .where({ 'oa.shop_id': shopId })
      .whereIn('oa.id', accessoryIds)
      .select(
        'oa.id',
        'oa.name_snapshot',
        'a.name as accessory_name',
        'cat.label as category_name'
      );
    for (const row of rows) {
      const label =
        pickLabel(row.name_snapshot, row.accessory_name, row.category_name) || 'Accessory';
      map.set(`accessory:${row.id}`, label);
    }
  }

  return map;
}

/**
 * @param {object} row
 * @param {Map<string, string>} labelsMap
 */
export function enrichChargeRowWithItemLabel(row, labelsMap) {
  if (!row?.item_type || !row?.item_id) return row;
  const key = `${row.item_type}:${row.item_id}`;
  const label = labelsMap.get(key);
  if (!label) return row;
  return {
    ...row,
    item_display_name: label,
    remarks:
      formatChecklistChargeRemarks(row.remarks, row.item_type, label, row.condition_kind) ||
      row.remarks,
  };
}

/**
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} shopId
 * @param {object[]} rows
 */
export async function enrichSecurityChargeRows(db, shopId, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const labelsMap = await loadChargeItemLabelsMap(db, shopId, list);
  return list.map((row) => enrichChargeRowWithItemLabel(row, labelsMap));
}
