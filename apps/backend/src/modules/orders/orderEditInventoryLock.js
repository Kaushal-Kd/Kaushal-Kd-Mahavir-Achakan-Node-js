import { todayIndiaISODate } from '@wrs/shared';

/**
 * True once the booking delivery date (D) is behind today (India calendar).
 * Same-day and future D stay editable.
 * @param {unknown} pickupDate
 * @param {string} [today]
 */
export function isDeliveryDatePast(pickupDate, today = todayIndiaISODate()) {
  const deliveryDate = String(pickupDate || '').slice(0, 10);
  const todayIso = String(today || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return false;
  }
  return deliveryDate < todayIso;
}

/** @param {unknown} item */
export function resolveLineGivenStatus(item) {
  const fromColumn = String(item?.given_status || '').trim();
  if (
    fromColumn === 'given_with_rent' ||
    fromColumn === 'pack_with_rent' ||
    fromColumn === 'regular'
  ) {
    return fromColumn;
  }
  if (item?.given_with_rent) return 'given_with_rent';
  if (item?.pack_with_rent) return 'pack_with_rent';
  return 'regular';
}

export function sameInventoryLine(before, after, itemType) {
  const inventoryKey = itemType === 'accessory' ? 'accessory_id' : 'product_id';
  const sameCore =
    String(before?.[inventoryKey] || '') === String(after?.[inventoryKey] || '') &&
    String(before?.type || 'rent') === String(after?.type || 'rent') &&
    Number(before?.qty || 0) === Number(after?.qty || 0);
  if (!sameCore) return false;
  if (itemType !== 'accessory') return true;
  return resolveLineGivenStatus(before) === resolveLineGivenStatus(after);
}
