/**
 * Booking contact fields live on the order. Shared customer master is only a
 * fallback for older rows that never stored a snapshot.
 */

function trimStr(value) {
  return value == null ? '' : String(value).trim();
}

function customerOf(row) {
  return row?.customer && typeof row.customer === 'object' ? row.customer : {};
}

/**
 * @param {object} [row] order list/detail row
 * @returns {string}
 */
export function resolveOrderContactPhone1(row) {
  const r = row && typeof row === 'object' ? row : {};
  const c = customerOf(r);
  return trimStr(r.contact_phone1 || c.phone1 || r.customer_phone);
}

/**
 * Contact No.2 is stored as `pickup_number` on the order.
 * @param {object} [row]
 * @returns {string}
 */
export function resolveOrderContactPhone2(row) {
  const r = row && typeof row === 'object' ? row : {};
  const c = customerOf(r);
  return trimStr(r.pickup_number || c.phone2 || r.customer_phone2);
}

/**
 * @param {object} [row]
 * @returns {string}
 */
export function resolveOrderContactAddress(row) {
  const r = row && typeof row === 'object' ? row : {};
  const c = customerOf(r);
  return trimStr(r.contact_address || c.address || r.customer_address);
}
