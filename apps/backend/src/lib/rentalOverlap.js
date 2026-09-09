/** Pre-delivery statuses — rental never left the shop until delivered. */
export const PRE_DELIVERY_ORDER_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
];

/**
 * Exclude stale pre-delivery reservations whose return date has passed.
 * Delivered / partially_returned overdue rentals are unchanged.
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {string} [oAlias]
 */
export function applyStalePreDeliveryRelease(qb, oAlias = 'o') {
  return qb.andWhere(function stalePreDeliveryFilter() {
    this.whereNotIn(`${oAlias}.status`, PRE_DELIVERY_ORDER_STATUSES).orWhereRaw(
      `COALESCE(${oAlias}.return_date, ${oAlias}.pickup_date) >= CURDATE()`
    );
  });
}
