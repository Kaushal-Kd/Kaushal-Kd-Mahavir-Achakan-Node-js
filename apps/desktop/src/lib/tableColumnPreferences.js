/**
 * Table column visibility + order (middle columns only; locked columns stay at edges).
 */

/**
 * @param {object} col
 * @returns {string}
 */
export function columnPickerLabel(col) {
  if (col.columnPickerLabel) return String(col.columnPickerLabel);
  if (typeof col.header === 'string') return col.header;
  return String(col.key || '');
}

/**
 * @param {object[]} allColumns
 * @returns {{ startLocked: object[], middle: object[], endLocked: object[] }}
 */
export function splitColumnGroups(allColumns) {
  const cols = allColumns || [];
  let firstFlex = -1;
  let lastFlex = -1;
  for (let i = 0; i < cols.length; i++) {
    if (!cols[i].locked) {
      if (firstFlex === -1) firstFlex = i;
      lastFlex = i;
    }
  }
  if (firstFlex === -1) {
    return { startLocked: [...cols], middle: [], endLocked: [] };
  }
  return {
    startLocked: cols.slice(0, firstFlex),
    middle: cols.slice(firstFlex, lastFlex + 1),
    endLocked: cols.slice(lastFlex + 1),
  };
}

/**
 * @param {object[]} middleColumns
 * @returns {string[]}
 */
export function defaultColumnOrder(middleColumns) {
  return (middleColumns || []).map((c) => c.key);
}

/**
 * Normalize saved order: known keys in saved order, then append new definition keys.
 * @param {string[]} savedOrder
 * @param {object[]} middleColumns
 * @returns {string[]}
 */
export function normalizeColumnOrder(savedOrder, middleColumns) {
  const middleKeys = defaultColumnOrder(middleColumns);
  const allowed = new Set(middleKeys);
  const seen = new Set();
  const out = [];
  for (const k of savedOrder || []) {
    if (!allowed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of middleKeys) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

/**
 * @param {object[]} middleColumns
 * @param {string[]} columnOrder
 * @returns {{ key: string, label: string }[]}
 */
export function buildPickerOptions(middleColumns, columnOrder) {
  const byKey = new Map((middleColumns || []).map((c) => [c.key, c]));
  const order = normalizeColumnOrder(columnOrder, middleColumns);
  return order
    .filter((key) => byKey.has(key))
    .map((key) => {
      const c = byKey.get(key);
      return { key, label: columnPickerLabel(c) };
    });
}

/**
 * @param {object[]} allColumns
 * @param {{ hiddenKeys?: string[], columnOrder?: string[] }} prefs
 * @returns {object[]}
 */
export function applyTableColumns(allColumns, prefs = {}) {
  const { startLocked, middle, endLocked } = splitColumnGroups(allColumns);
  const hiddenKeys = prefs.hiddenKeys || [];
  const order = normalizeColumnOrder(prefs.columnOrder, middle);

  const byKey = new Map(middle.map((c) => [c.key, c]));
  const orderedMiddle = [];
  for (const key of order) {
    const col = byKey.get(key);
    if (!col || hiddenKeys.includes(key)) continue;
    orderedMiddle.push(col);
  }

  return [...startLocked, ...orderedMiddle, ...endLocked];
}

/**
 * Move dragKey to the position of dropKey in order array.
 * @param {string[]} order
 * @param {string} dragKey
 * @param {string} dropKey
 * @returns {string[]}
 */
export function reorderColumnKeys(order, dragKey, dropKey) {
  if (!dragKey || !dropKey || dragKey === dropKey) return [...order];
  const next = order.filter((k) => k !== dragKey);
  const dropIdx = next.indexOf(dropKey);
  if (dropIdx === -1) return [...order];
  next.splice(dropIdx, 0, dragKey);
  return next;
}
