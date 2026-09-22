/**
 * @param {object|null|undefined} row
 * @returns {object[]}
 */
export function damageReplacementsForRow(row) {
  const all = Array.isArray(row?.damage_replacements) ? row.damage_replacements : [];
  if (!all.length) return [];
  if (row?.product_item_id) {
    return all.filter((item) => String(item.target_order_item_id || '') === String(row.product_item_id));
  }
  if (row?.line_has_damage_replacement) {
    return all.filter((item) => String(item.target_order_item_id || '') === String(row.id));
  }
  return all;
}

/**
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function rowHasDamageReplacement(row) {
  if (!row) return false;
  if (row.product_item_id) return damageReplacementsForRow(row).length > 0;
  if (row.line_has_damage_replacement === true) return true;
  if (row.line_has_damage_replacement === false && row.order_id && String(row.order_id) !== String(row.id)) {
    return false;
  }
  if (row.has_damage_replacement) return true;
  if (Number(row.damage_replacement_count) > 0) return true;
  return damageReplacementsForRow(row).length > 0;
}

/**
 * Red damage-affected rows beat yellow next-booking gap tint.
 * @param {object|null|undefined} row
 * @param {string} [gapClass]
 * @returns {string}
 */
export function bookingAlertRowClass(row, gapClass = '') {
  if (rowHasDamageReplacement(row)) {
    return 'damage-replacement-row !bg-red-50 hover:!bg-red-100';
  }
  return gapClass || '';
}
