/** Allowed `sort_by` values for order list screens (maps to `orders` columns). */
export const ORDER_LIST_SORT_FIELDS = new Set([
  'pickup_date',
  'return_date',
  'order_number',
  'booking_date',
  'created_at',
  'bill_book_no',
]);

const SORT_COLUMN_BY_FIELD = {
  pickup_date: 'o.pickup_date',
  return_date: 'o.return_date',
  booking_date: 'o.booking_date',
  created_at: 'o.created_at',
  order_number: 'o.bill_no',
  bill_book_no: 'o.bill_book_no',
};

const DATE_SORT_FIELDS = new Set(['pickup_date', 'return_date', 'booking_date', 'created_at']);

/**
 * @param {string} sortBy
 * @param {string} [defaultField]
 * @returns {string} e.g. `o.pickup_date,o.bill_no`
 */
export function buildOrdersListSortParam(sortBy, defaultField = 'pickup_date') {
  const field = ORDER_LIST_SORT_FIELDS.has(sortBy) ? sortBy : defaultField;
  const primary = SORT_COLUMN_BY_FIELD[field];
  if (DATE_SORT_FIELDS.has(field) || field === 'bill_book_no') {
    return `${primary},o.bill_no`;
  }
  return primary;
}
