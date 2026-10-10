const SALES_LIST_SORT = {
  high: '-s.bill_no,-s.created_at',
  low: 's.bill_no,-s.created_at',
  az: 's.customer_name,-s.bill_no,-s.created_at',
  za: '-s.customer_name,-s.bill_no,-s.created_at',
};

/** Bill sequence high→low by default. A–Z / Z–A is customer name, then bill no. */
export function resolveSalesListSort(query = {}) {
  const key = String(query.sort_by || '').trim();
  if (SALES_LIST_SORT[key]) return SALES_LIST_SORT[key];
  return SALES_LIST_SORT.high;
}
