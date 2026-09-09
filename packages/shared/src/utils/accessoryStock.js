/**
 * Stock actually available to rent or sell: total less the spare reserve and
 * anything currently written off as damaged.
 *
 * @param {{ qty?: number|null, spare_qty?: number|null, damaged_qty?: number|null }} row
 * @returns {number}
 */
export function accessoryRentableQty(row) {
  const total = Math.max(0, Number(row?.qty ?? 0) || 0);
  const spare = Math.max(0, Number(row?.spare_qty ?? 0) || 0);
  const damaged = Math.max(0, Number(row?.damaged_qty ?? 0) || 0);
  return Math.max(0, total - spare - damaged);
}

/**
 * Explain what is being held back from the total, so a shortfall between stock
 * on hand and stock offered is never unexplained. Returns '' when nothing is
 * held back.
 *
 * @param {number} spareQty
 * @param {number} damagedQty
 * @returns {string}
 */
function heldBackSuffix(spareQty, damagedQty) {
  const parts = [];
  if (spareQty > 0) parts.push(`${spareQty} kept as spare`);
  if (damagedQty > 0) parts.push(`${damagedQty} damaged`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * @param {string} name
 * @param {number} spareQty
 * @param {number} availableQty
 * @param {'rent'|'sell'|'generic'} [context]
 * @param {number} [damagedQty] stock written off as damaged, held back like spare
 * @returns {string}
 */
export function formatAccessorySpareMessage(
  name,
  spareQty,
  availableQty,
  context = 'generic',
  damagedQty = 0
) {
  const label = String(name || 'Accessory').trim() || 'Accessory';
  const spare = Math.max(0, Number(spareQty) || 0);
  const damaged = Math.max(0, Number(damagedQty) || 0);
  const available = Math.max(0, Number(availableQty) || 0);
  const spareSuffix = heldBackSuffix(spare, damaged);

  if (context === 'rent') {
    if (available > 0) {
      return `${label}: only ${available} available for selected dates${spareSuffix}`;
    }
    return spareSuffix
      ? `${label} is not available for selected dates${spareSuffix}`
      : `${label} is not available for selected dates`;
  }

  if (available > 0) {
    return `${label}: only ${available} available${spareSuffix}`;
  }
  return spareSuffix ? `${label} is not available${spareSuffix}` : `${label} is out of stock`;
}

/**
 * @param {string} name
 * @param {number} requestedQty
 * @param {number} availableQty
 * @param {number} spareQty
 * @param {'rent'|'sell'} [context]
 * @param {number} [damagedQty] stock written off as damaged, held back like spare
 * @returns {string}
 */
export function formatAccessoryQtyExceededMessage(
  name,
  requestedQty,
  availableQty,
  spareQty,
  context = 'rent',
  damagedQty = 0
) {
  const label = String(name || 'Accessory').trim() || 'Accessory';
  const requested = Math.max(1, Number(requestedQty) || 1);
  const available = Math.max(0, Number(availableQty) || 0);
  const spare = Math.max(0, Number(spareQty) || 0);
  const damaged = Math.max(0, Number(damagedQty) || 0);
  const spareSuffix = heldBackSuffix(spare, damaged);

  if (context === 'rent') {
    return `${label}: requested ${requested}, only ${available} available for selected dates${spareSuffix}`;
  }
  return `${label}: requested ${requested}, only ${available} available${spareSuffix}`;
}
