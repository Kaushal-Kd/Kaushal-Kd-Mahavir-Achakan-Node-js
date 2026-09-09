/**
 * Order lifecycle (requirements §50).
 * Per-item checklist auto-rolls up into the order-level status.
 */
export const ORDER_STATUS = Object.freeze({
  DRAFT: 'draft',
  BOOKED: 'booked',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  ITEM_TO_COLLECT: 'item_to_collect',
  IN_PREPARATION: 'in_preparation',
  READY_FOR_DELIVERY: 'ready_for_delivery',
  DELIVERED: 'delivered',
  PARTIALLY_RETURNED: 'partially_returned',
  RETURNED: 'returned',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
});

/** Order status groups for the Booked Product line-items report (filter + backend). */
export const BOOKED_PRODUCT_STATUS_BUCKETS = Object.freeze({
  booked: Object.freeze([
    'booked',
    'pending',
    'confirmed',
    'draft',
    'item_to_collect',
    'in_preparation',
    'ready_for_delivery',
  ]),
  delivered: Object.freeze(['delivered']),
  returned: Object.freeze(['partially_returned', 'returned', 'closed']),
  cancelled: Object.freeze(['cancelled']),
});

/** UI label for each booked-product status bucket (matches filter dropdown). */
export const BOOKED_PRODUCT_BUCKET_LABELS = Object.freeze({
  booked: 'Booked',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
});

/**
 * Maps granular `orders.status` to the same bucket keys as `BOOKED_PRODUCT_STATUS_BUCKETS`.
 * @param {string|null|undefined} orderStatus
 * @returns {'booked'|'delivered'|'returned'|'cancelled'|null}
 */
export function orderStatusToBookedProductBucket(orderStatus) {
  const s = String(orderStatus || '').trim();
  if (!s) return null;
  for (const bucket of Object.keys(BOOKED_PRODUCT_STATUS_BUCKETS)) {
    const statuses = BOOKED_PRODUCT_STATUS_BUCKETS[bucket];
    if (statuses.includes(s)) return bucket;
  }
  return null;
}

/** Income/expense report transaction_type values that filter order payments by status bucket. */
export const ORDER_PAYMENT_STATUS_FILTER_TYPES = Object.freeze([
  'order_payment_booked',
  'order_payment_delivered',
  'order_payment_returned',
]);

/**
 * Maps income/expense transaction_type to order status list for SQL `whereIn(o.status)`.
 * @param {string|null|undefined} transactionType
 * @returns {string[]|null}
 */
export function orderPaymentStatusBucketForFilter(transactionType) {
  const tx = String(transactionType || '').trim();
  if (tx === 'order_payment_booked') return [...BOOKED_PRODUCT_STATUS_BUCKETS.booked];
  if (tx === 'order_payment_delivered') return [...BOOKED_PRODUCT_STATUS_BUCKETS.delivered];
  if (tx === 'order_payment_returned') return [...BOOKED_PRODUCT_STATUS_BUCKETS.returned];
  return null;
}

/** True when transaction_type filters order rent payments (all or by status bucket). */
export function isOrderRentPaymentTransactionType(transactionType) {
  const tx = String(transactionType || '').trim();
  return tx === 'booking_payment' || ORDER_PAYMENT_STATUS_FILTER_TYPES.includes(tx);
}

/** Pre-handover order statuses (dashboard pending delivery + delivery list pending filter). */
export const DELIVERY_PENDING_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.BOOKED,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.ITEM_TO_COLLECT,
  ORDER_STATUS.IN_PREPARATION,
  ORDER_STATUS.READY_FOR_DELIVERY,
]);

/** Default delivery list “All”: pending handover + delivered (delivered rows sorted last in UI). */
export const DELIVERY_LIST_DEFAULT_ORDER_STATUSES = Object.freeze([
  ...DELIVERY_PENDING_ORDER_STATUSES,
  ORDER_STATUS.DELIVERED,
]);

/** @returns {string} Comma-separated statuses for orders API `statuses` query param. */
export function deliveryPendingStatusesCsv() {
  return DELIVERY_PENDING_ORDER_STATUSES.join(',');
}

/** @returns {string} Comma-separated statuses for delivery list default “All” filter. */
export function deliveryListDefaultStatusesCsv() {
  return DELIVERY_LIST_DEFAULT_ORDER_STATUSES.join(',');
}

/** Default return list: pending return + fully returned (returned/closed sorted last in UI). */
export const RETURN_LIST_DEFAULT_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.PARTIALLY_RETURNED,
  ORDER_STATUS.RETURNED,
  ORDER_STATUS.CLOSED,
]);

/** @returns {string} Comma-separated statuses for return list default “All” / pending-return preset. */
export function returnListDefaultStatusesCsv() {
  return RETURN_LIST_DEFAULT_ORDER_STATUSES.join(',');
}

export const ORDER_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  booked: 'Booked',
  pending: 'Pending',
  confirmed: 'Confirmed',
  item_to_collect: 'Item to collect',
  in_preparation: 'In Preparation',
  ready_for_delivery: 'Ready for Delivery',
  delivered: 'Delivered',
  partially_returned: 'Partially Returned',
  returned: 'Returned',
  closed: 'Closed',
  cancelled: 'Cancelled',
});

/** Per-line checklist stage keys (order_items / order_accessories stage_flags). */
export const ITEM_STAGE = Object.freeze({
  ITEM_TO_COLLECT: 'item_to_collect',
  PREPARED: 'prepared',
  DELIVERED: 'delivered',
  RECEIVED: 'received',
});

export const ITEM_STAGE_LABELS = Object.freeze({
  item_to_collect: 'Item to collect',
  prepared: 'Prepared',
  delivered: 'Delivered',
  received: 'Received',
});

export const PRODUCT_STATUS = Object.freeze({
  AVAILABLE: 'available',
  BOOKED: 'booked',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  WASHING: 'washing',
  REPAIR: 'repair',
  SOLD: 'sold',
  LOST: 'lost',
});
