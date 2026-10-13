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

const COMBINED_DAMAGE_MISSING_PREFIX = /^damage\s*\/\s*missing\b/i;

export function resolveChargeConditionKind(conditionKind, remarks, lineFlags = null) {
  const kind = String(conditionKind || '').toLowerCase();
  if (kind === 'missing' || kind === 'damage') return kind;
  if (lineFlags?.missing) return 'missing';
  if (lineFlags?.damaged) return 'damage';
  const raw = String(remarks || '').trim().toLowerCase();
  if (raw.startsWith('missing')) return 'missing';
  if (COMBINED_DAMAGE_MISSING_PREFIX.test(raw)) return null;
  if (raw.startsWith('damage')) return 'damage';
  return null;
}

function conditionPrefix(kind) {
  return kind === 'missing' ? 'Missing' : 'Damage';
}

/**
 * Remarks name one condition only — Missing or Damage, never "Damage/missing".
 * @param {string|null|undefined} remarks
 * @param {string|null|undefined} itemType
 * @param {string|null|undefined} label
 * @param {string|null|undefined} conditionKind
 */
export function formatChecklistChargeRemarks(remarks, itemType, label, conditionKind = null) {
  const name = String(label || '').trim();
  const raw = String(remarks || '').trim();
  if (!name || !itemType) {
    return rewriteAmbiguousConditionRemarks(raw, conditionKind);
  }

  if (raw.startsWith('Backfill')) return `Backfill · ${name}`;
  if (/^condition cleared/i.test(raw)) return `Condition cleared · ${name}`;

  const kind = resolveChargeConditionKind(conditionKind, raw);
  if (kind) return `${conditionPrefix(kind)} · ${name}`;
  if (raw && !COMBINED_DAMAGE_MISSING_PREFIX.test(raw)) return raw;
  return name;
}

export function rewriteAmbiguousConditionRemarks(remarks, conditionKind = null) {
  const raw = String(remarks || '').trim();
  if (!raw) return raw || null;
  const kind = resolveChargeConditionKind(conditionKind, raw);
  if (!COMBINED_DAMAGE_MISSING_PREFIX.test(raw)) return raw;
  const rest = raw.replace(COMBINED_DAMAGE_MISSING_PREFIX, '').replace(/^[\s·\-–:]+/, '');
  if (kind) return rest ? `${conditionPrefix(kind)} · ${rest}` : conditionPrefix(kind);
  return rest || raw;
}

/**
 * Batch-load labels for security charge rows that reference checklist lines.
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} shopId
 * @param {Array<{ item_type?: string|null, item_id?: string|null }>} charges
 * @returns {Promise<Map<string, { label: string, missing: boolean, damaged: boolean }>>} keys `${itemType}:${itemId}`
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
      .select(
        'oi.id',
        'oi.name_snapshot',
        'oi.code_snapshot',
        'oi.missing',
        'oi.damaged',
        'p.name as product_name'
      );
    for (const row of rows) {
      const label = pickLabel(row.name_snapshot, row.product_name, row.code_snapshot) || 'Item';
      map.set(`item:${row.id}`, { label, missing: !!row.missing, damaged: !!row.damaged });
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
        'oa.missing',
        'oa.damaged',
        'a.name as accessory_name',
        'cat.label as category_name'
      );
    for (const row of rows) {
      const label =
        pickLabel(row.name_snapshot, row.accessory_name, row.category_name) || 'Accessory';
      map.set(`accessory:${row.id}`, {
        label,
        missing: !!row.missing,
        damaged: !!row.damaged,
      });
    }
  }

  return map;
}

/**
 * @param {object} row
 * @param {Map<string, string>} labelsMap
 */
function labelFromMapEntry(entry) {
  if (!entry) return '';
  return typeof entry === 'string' ? entry : String(entry.label || '').trim();
}

export function enrichChargeRowWithItemLabel(row, labelsMap) {
  if (!row?.item_type || !row?.item_id) {
    const remarks = rewriteAmbiguousConditionRemarks(row?.remarks, row?.condition_kind);
    return remarks === row?.remarks ? row : { ...row, remarks };
  }
  const key = `${row.item_type}:${row.item_id}`;
  const entry = labelsMap.get(key);
  const label = labelFromMapEntry(entry);
  if (!label) {
    const remarks = rewriteAmbiguousConditionRemarks(row.remarks, row.condition_kind);
    return remarks === row.remarks ? row : { ...row, remarks };
  }
  const kind = resolveChargeConditionKind(row.condition_kind, row.remarks, entry);
  return {
    ...row,
    item_display_name: label,
    remarks:
      formatChecklistChargeRemarks(row.remarks, row.item_type, label, kind) || row.remarks,
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
