/**
 * Diff two JSON snapshots for system log display (field-level, line-aware).
 */

import {
  normalizeAccessoryStageFlagsFromParsed,
  normalizeProductStageFlagsFromParsed,
  parseStageFlagsJson,
} from './stageFlags.js';

const FIELD_LABELS = {
  order_number: 'Bill no.',
  status: 'Status',
  booking_date: 'Booking date',
  booking_time: 'Booking time',
  pickup_name: 'Pickup name',
  pickup_number: 'Pickup phone',
  reference_name: 'Reference name',
  customer_id: 'Customer',
  sales_person_id: 'Sales person',
  sales_person_name: 'Sales person',
  subtotal: 'Subtotal',
  discount_total: 'Discount',
  tax_total: 'Tax',
  total_amount: 'Total amount',
  advance_amount: 'Advance',
  paid_amount: 'Paid',
  balance: 'Balance',
  deposit_amount: 'Deposit',
  customer_notes: 'Customer notes',
  name: 'Name',
  phone: 'Phone',
  phone1: 'Phone',
  phone2: 'Phone 2',
  email: 'Email',
  address: 'Address',
  product_id: 'Product',
  accessory_id: 'Accessory',
  code: 'Code',
  qty: 'Qty',
  rent: 'Rent',
  sell_price: 'Sell price',
  discount: 'Discount',
  pickup_date: 'Pickup date',
  return_date: 'Return date',
  pickup_time_slot: 'Pickup time',
  return_time_slot: 'Return time',
  remarks: 'Remarks',
  stage_flags: 'Stage',
  line_kind: 'Line type',
  category_name: 'Category',
  name_snapshot: 'Name',
  product_name: 'Product name',
  accessory_name: 'Accessory name',
  description: 'Description',
  rate: 'Rate',
  amount: 'Amount',
  sale_number: 'Sale no.',
  purchase_number: 'Purchase no.',
  vendor_name: 'Vendor',
  payable_amount: 'Payable',
};

const LINE_ARRAY_KEYS = new Set(['items', 'accessories']);

const LINE_SUMMARY_KEYS = ['code', 'name_snapshot', 'product_name', 'name', 'description', 'category_name'];

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function parseNumericCompareValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return null;
}

function normalizeCompareValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const num = parseNumericCompareValue(v);
  if (num !== null) return num;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return JSON.stringify(v);
  if (isPlainObject(v)) return JSON.stringify(v);
  return String(v);
}

function valuesEqual(a, b) {
  return normalizeCompareValue(a) === normalizeCompareValue(b);
}

function stageFlagsEqual(a, b, arrayKey) {
  const normalize =
    arrayKey === 'accessories'
      ? normalizeAccessoryStageFlagsFromParsed
      : normalizeProductStageFlagsFromParsed;
  const left = normalize(parseStageFlagsJson(a));
  const right = normalize(parseStageFlagsJson(b));
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldValuesEqual(field, a, b, arrayKey) {
  if (field === 'stage_flags') return stageFlagsEqual(a, b, arrayKey);
  return valuesEqual(a, b);
}

/** @param {unknown} v */
export function formatSnapshotDisplayValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '—';
    return v.length === 1 ? formatSnapshotDisplayValue(v[0]) : `[${v.length} items]`;
  }
  if (isPlainObject(v)) {
    const parts = Object.entries(v)
      .filter(([, val]) => val !== null && val !== undefined && val !== '')
      .slice(0, 4)
      .map(([k, val]) => `${labelForFieldKey(k)}: ${formatSnapshotDisplayValue(val)}`);
    return parts.length ? parts.join(', ') : '—';
  }
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function labelForFieldKey(key) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelForPath(path) {
  if (!path) return 'Value';
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && LINE_ARRAY_KEYS.has(parts[parts.length - 2])) {
    return `${parts.slice(0, -1).join(' · ')} · ${labelForFieldKey(last)}`;
  }
  if (parts[0] === 'order') return `Order · ${labelForFieldKey(last)}`;
  if (parts[0] === 'customer') return `Customer · ${labelForFieldKey(last)}`;
  return parts.map((p, i) => (i === parts.length - 1 ? labelForFieldKey(p) : p)).join(' · ');
}

/** @param {Record<string, unknown>} item */
function lineDescriptor(item, arrayKey, { short = false } = {}) {
  const code = item.code || item.product_code || item.code_snapshot;
  const name =
    item.product_name ||
    item.name_snapshot ||
    item.name ||
    item.description ||
    item.category_name ||
    item.accessory_name;
  const bits = [name, code].filter(Boolean).map(String);
  const base = bits.length ? bits.join(' · ') : String(item.id || '').slice(0, 8) || 'Line';
  if (short) return base;
  if (arrayKey === 'items') return `Item: ${base}`;
  if (arrayKey === 'accessories') return `Accessory: ${base}`;
  return base;
}

/** @param {string|null} arrayKey */
function lineEntityKey(item, arrayKey) {
  if (!isPlainObject(item)) return null;
  if (arrayKey === 'items' && item.product_id != null && item.product_id !== '') {
    return `product:${item.product_id}`;
  }
  if (arrayKey === 'accessories' && item.accessory_id != null && item.accessory_id !== '') {
    return `accessory:${item.accessory_id}`;
  }
  const code = item.code || item.code_snapshot || item.product_code;
  if (code) return `code:${code}`;
  return null;
}

/** @param {string|null} arrayKey */
function replacementChangeLabel(prevItem, nextItem, arrayKey) {
  const prevShort = lineDescriptor(prevItem, arrayKey, { short: true });
  const nextShort = lineDescriptor(nextItem, arrayKey, { short: true });
  if (arrayKey === 'accessories') {
    return `Accessory changed — ${prevShort} → ${nextShort}`;
  }
  if (arrayKey === 'items') {
    return `Product changed — ${prevShort} → ${nextShort}`;
  }
  return `Line changed — ${prevShort} → ${nextShort}`;
}

/** @param {Record<string, unknown>} item */
function lineAddedSummary(item) {
  const parts = [];
  for (const key of LINE_SUMMARY_KEYS) {
    if (item[key] != null && item[key] !== '') {
      parts.push(`${labelForFieldKey(key)}: ${formatSnapshotDisplayValue(item[key])}`);
    }
  }
  for (const key of ['qty', 'rent', 'sell_price', 'rate', 'amount', 'discount']) {
    if (item[key] != null && item[key] !== '' && !parts.some((p) => p.startsWith(labelForFieldKey(key)))) {
      parts.push(`${labelForFieldKey(key)}: ${formatSnapshotDisplayValue(item[key])}`);
    }
  }
  return parts.length ? parts.join('; ') : formatSnapshotDisplayValue(item);
}

/**
 * @typedef {'added'|'removed'|'modified'} SnapshotChangeKind
 * @typedef {{ path: string, label: string, previous: string, next: string, kind?: SnapshotChangeKind }} SnapshotChangeRow
 */

/**
 * @param {unknown} prev
 * @param {unknown} next
 * @param {{ pathPrefix?: string }} [options]
 * @returns {{ changes: SnapshotChangeRow[], changeCount: number }}
 */
export function diffSnapshots(prev, next, options = {}) {
  const changes = [];
  diffValue(prev ?? null, next ?? null, options.pathPrefix || '', changes);
  const filtered = filterNoOpLineChanges(changes);
  return { changes: filtered, changeCount: filtered.length };
}

/**
 * @param {string} path
 */
export function formatFieldPath(path) {
  return labelForPath(path);
}

/** @param {unknown} prev @param {unknown} next @param {string} path @param {SnapshotChangeRow[]} out */
function diffValue(prev, next, path, out) {
  if (valuesEqual(prev, next)) return;

  const prevArr = Array.isArray(prev) ? prev : null;
  const nextArr = Array.isArray(next) ? next : null;

  if (prevArr || nextArr) {
    diffArrays(prevArr || [], nextArr || [], path, out);
    return;
  }

  if (isPlainObject(prev) || isPlainObject(next)) {
    diffObjects(
      isPlainObject(prev) ? prev : {},
      isPlainObject(next) ? next : {},
      path,
      out
    );
    return;
  }

  pushChange(out, {
    path,
    label: labelForPath(path),
    previous: formatSnapshotDisplayValue(prev),
    next: formatSnapshotDisplayValue(next),
    kind: 'modified',
  });
}

/** @param {Record<string, unknown>} prev @param {Record<string, unknown>} next @param {string} pathPrefix @param {SnapshotChangeRow[]} out */
function diffObjects(prev, next, pathPrefix, out) {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const p = prev[key];
    const n = next[key];

    if (LINE_ARRAY_KEYS.has(key) && (Array.isArray(p) || Array.isArray(n))) {
      diffLineArray(p, n, childPath, key, out);
      continue;
    }

    if (Array.isArray(p) || Array.isArray(n)) {
      diffArrays(Array.isArray(p) ? p : [], Array.isArray(n) ? n : [], childPath, out);
      continue;
    }

    if (isPlainObject(p) && isPlainObject(n)) {
      diffObjects(p, n, childPath, out);
      continue;
    }

    if (!valuesEqual(p, n)) {
      if (p === undefined || p === null) {
        if (isPlainObject(n)) {
          diffObjects({}, n, childPath, out);
        } else {
          pushChange(out, {
            path: childPath,
            label: labelForPath(childPath),
            previous: '—',
            next: formatSnapshotDisplayValue(n),
            kind: 'added',
          });
        }
      } else if (n === undefined || n === null) {
        pushChange(out, {
          path: childPath,
          label: labelForPath(childPath),
          previous: formatSnapshotDisplayValue(p),
          next: '—',
          kind: 'removed',
        });
      } else {
        pushChange(out, {
          path: childPath,
          label: labelForPath(childPath),
          previous: formatSnapshotDisplayValue(p),
          next: formatSnapshotDisplayValue(n),
          kind: 'modified',
        });
      }
    }
  }
}

/** @param {unknown[]} prev @param {unknown[]} next @param {string} pathPrefix @param {SnapshotChangeRow[]} out */
function diffArrays(prev, next, pathPrefix, out) {
  const prevHasId = prev.some((x) => isPlainObject(x) && x.id);
  const nextHasId = next.some((x) => isPlainObject(x) && x.id);
  if (prevHasId || nextHasId) {
    diffArrayById(prev, next, pathPrefix, null, out);
    return;
  }
  if (!valuesEqual(prev, next)) {
    pushChange(out, {
      path: pathPrefix,
      label: labelForPath(pathPrefix),
      previous: formatSnapshotDisplayValue(prev),
      next: formatSnapshotDisplayValue(next),
      kind: 'modified',
    });
  }
}

/** @param {unknown} prev @param {unknown} next @param {string} pathPrefix @param {string|null} arrayKey @param {SnapshotChangeRow[]} out */
function diffLineArray(prev, next, pathPrefix, arrayKey, out) {
  const p = Array.isArray(prev) ? prev : [];
  const n = Array.isArray(next) ? next : [];
  diffArrayById(p, n, pathPrefix, arrayKey, out);
}

/**
 * @param {Record<string, unknown>} prevItem
 * @param {Record<string, unknown>} nextItem
 * @param {string} pathPrefix
 * @param {string|null} arrayKey
 * @param {SnapshotChangeRow[]} out
 */
function diffMatchedLineItems(prevItem, nextItem, pathPrefix, arrayKey, out) {
  const id = String(nextItem.id || prevItem.id || '');
  const baseLabel = lineDescriptor(nextItem, arrayKey);
  const fieldKeys = new Set([...Object.keys(prevItem), ...Object.keys(nextItem)]);
  for (const field of fieldKeys) {
    if (field === 'id') continue;
    const pv = prevItem[field];
    const nv = nextItem[field];
    if (fieldValuesEqual(field, pv, nv, arrayKey)) continue;
    pushChange(out, {
      path: `${pathPrefix}[${id}].${field}`,
      label: `${baseLabel} · ${labelForFieldKey(field)}`,
      previous: formatSnapshotDisplayValue(pv),
      next: formatSnapshotDisplayValue(nv),
      kind: 'modified',
    });
  }
}

/** @param {unknown[]} prev @param {unknown[]} next @param {string} pathPrefix @param {string|null} arrayKey @param {SnapshotChangeRow[]} out */
function diffArrayById(prev, next, pathPrefix, arrayKey, out) {
  const prevMap = new Map();
  const nextMap = new Map();

  for (const item of prev) {
    if (isPlainObject(item) && item.id) prevMap.set(String(item.id), item);
  }
  for (const item of next) {
    if (isPlainObject(item) && item.id) nextMap.set(String(item.id), item);
  }

  const addedLabel = arrayKey === 'accessories' ? 'Accessory added' : arrayKey === 'items' ? 'Item added' : 'Line added';
  const removedLabel =
    arrayKey === 'accessories' ? 'Accessory removed' : arrayKey === 'items' ? 'Item removed' : 'Line removed';

  const unmatchedAdded = [];
  const unmatchedRemoved = [];

  for (const [id, item] of nextMap) {
    if (!prevMap.has(id)) unmatchedAdded.push({ id, item });
  }
  for (const [id, item] of prevMap) {
    if (!nextMap.has(id)) unmatchedRemoved.push({ id, item });
  }

  const pairedAddedIds = new Set();
  const pairedRemovedIds = new Set();

  for (const removed of unmatchedRemoved) {
    const entityKey = lineEntityKey(removed.item, arrayKey);
    if (!entityKey) continue;
    const matchIdx = unmatchedAdded.findIndex(
      (added) =>
        !pairedAddedIds.has(added.id) &&
        lineEntityKey(added.item, arrayKey) === entityKey
    );
    if (matchIdx < 0) continue;
    const added = unmatchedAdded[matchIdx];
    pairedRemovedIds.add(removed.id);
    pairedAddedIds.add(added.id);
    diffMatchedLineItems(removed.item, added.item, pathPrefix, arrayKey, out);
  }

  let stillRemoved = unmatchedRemoved.filter((r) => !pairedRemovedIds.has(r.id));
  let stillAdded = unmatchedAdded.filter((a) => !pairedAddedIds.has(a.id));

  if (stillRemoved.length === 1 && stillAdded.length === 1) {
    const removed = stillRemoved[0];
    const added = stillAdded[0];
    pairedRemovedIds.add(removed.id);
    pairedAddedIds.add(added.id);
    pushChange(out, {
      path: `${pathPrefix}[${removed.id}->${added.id}]`,
      label: replacementChangeLabel(removed.item, added.item, arrayKey),
      previous: lineAddedSummary(removed.item),
      next: lineAddedSummary(added.item),
      kind: 'modified',
    });
    stillRemoved = [];
    stillAdded = [];
  } else if (stillRemoved.length > 0 && stillAdded.length > 0) {
    for (const removed of stillRemoved) {
      if (pairedRemovedIds.has(removed.id)) continue;
      let best = null;
      let bestScore = -1;
      for (const added of stillAdded) {
        if (pairedAddedIds.has(added.id)) continue;
        let score = 0;
        const rk = lineEntityKey(removed.item, arrayKey);
        const ak = lineEntityKey(added.item, arrayKey);
        if (rk && ak && rk === ak) score = 2;
        else if (removed.item.qty != null && valuesEqual(removed.item.qty, added.item.qty)) score = 1;
        if (score > bestScore) {
          bestScore = score;
          best = added;
        }
      }
      if (best && bestScore > 0) {
        pairedRemovedIds.add(removed.id);
        pairedAddedIds.add(best.id);
        pushChange(out, {
          path: `${pathPrefix}[${removed.id}->${best.id}]`,
          label: replacementChangeLabel(removed.item, best.item, arrayKey),
          previous: lineAddedSummary(removed.item),
          next: lineAddedSummary(best.item),
          kind: 'modified',
        });
      }
    }
    stillRemoved = stillRemoved.filter((r) => !pairedRemovedIds.has(r.id));
    stillAdded = stillAdded.filter((a) => !pairedAddedIds.has(a.id));
  }

  for (const { id, item } of stillAdded) {
    if (pairedAddedIds.has(id)) continue;
    const desc = lineDescriptor(item, arrayKey);
    pushChange(out, {
      path: `${pathPrefix}[${id}]`,
      label: `${addedLabel} — ${desc.replace(/^(Item|Accessory): /, '')}`,
      previous: '—',
      next: lineAddedSummary(item),
      kind: 'added',
    });
  }

  for (const { id, item } of stillRemoved) {
    if (pairedRemovedIds.has(id)) continue;
    const desc = lineDescriptor(item, arrayKey);
    pushChange(out, {
      path: `${pathPrefix}[${id}]`,
      label: `${removedLabel} — ${desc.replace(/^(Item|Accessory): /, '')}`,
      previous: lineAddedSummary(item),
      next: '—',
      kind: 'removed',
    });
  }

  for (const [id, nextItem] of nextMap) {
    const prevItem = prevMap.get(id);
    if (!prevItem) continue;
    diffMatchedLineItems(prevItem, nextItem, pathPrefix, arrayKey, out);
  }

  if (prevMap.size === 0 && nextMap.size === 0 && (prev.length > 0 || next.length > 0)) {
    diffArrays(prev, next, pathPrefix, out);
  }
}

/** @param {SnapshotChangeRow[]} out @param {SnapshotChangeRow} row */
function pushChange(out, row) {
  out.push(row);
}

/**
 * Remove rows where formatted previous/next values are identical (safety net after diff).
 * @param {SnapshotChangeRow[]} changes
 * @returns {SnapshotChangeRow[]}
 */
export function filterNoOpLineChanges(changes) {
  if (!changes?.length) return [];
  return changes.filter((row) => {
    const prev = String(row.previous ?? '').trim();
    const next = String(row.next ?? '').trim();
    if (prev === next) return false;
    if ((prev === '—' || prev === '') && (next === '—' || next === '')) return false;
    return true;
  });
}
