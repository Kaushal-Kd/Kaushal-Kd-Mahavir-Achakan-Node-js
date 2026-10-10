/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasTokenPrintStamp(value) {
  if (value == null || value === false) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const s = String(value).trim();
  if (!s || s === '0' || s.startsWith('0000-00-00')) return false;
  return true;
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1';
}

function orderHasProductTokenLines(order) {
  if (Number(order?.product_qty) > 0) return true;
  if (Array.isArray(order?.items) && order.items.length > 0) return true;
  return false;
}

function orderHasPackAccessoryTokenLines(order) {
  if (isTruthyFlag(order?.has_pack_accessory_token)) return true;
  if (Number(order?.pack_accessory_qty) > 0) return true;
  if (
    Array.isArray(order?.accessories) &&
    order.accessories.some((row) => String(row?.given_status || '').trim() === 'pack_with_rent')
  ) {
    return true;
  }
  return false;
}

/**
 * List Tags icon is blue only when every applicable token type has been printed.
 * Products apply when the booking has product lines; accessories apply only for pack-with-rent.
 * @param {object} order
 * @returns {boolean}
 */
export function isBookingTokenFullyPrinted(order) {
  if (!order) return false;
  const hasProduct = orderHasProductTokenLines(order);
  const hasAccessory = orderHasPackAccessoryTokenLines(order);
  if (!hasProduct && !hasAccessory) return false;
  if (hasProduct && !hasTokenPrintStamp(order.product_token_printed_at)) return false;
  if (hasAccessory && !hasTokenPrintStamp(order.accessory_token_printed_at)) return false;
  return true;
}

export function bookingTokenPrintIconClassName(order) {
  return isBookingTokenFullyPrinted(order)
    ? 'rounded-none bg-brand-light/50 text-brand hover:bg-brand-light'
    : 'rounded-none bg-red-50 text-red-600 hover:bg-red-100';
}

/**
 * @param {object} order
 * @param {'product'|'accessory'} kind
 */
export function stampTokenPrintedLocally(order, kind) {
  if (!order) return order;
  const field = kind === 'accessory' ? 'accessory_token_printed_at' : 'product_token_printed_at';
  if (hasTokenPrintStamp(order[field])) return order;
  return { ...order, [field]: new Date().toISOString() };
}
