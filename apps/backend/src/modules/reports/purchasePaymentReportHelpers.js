/** Payment categories used for customer receipts and vendor purchase payments. */
export const VENDOR_PAYMENT_CATEGORIES = ['advance', 'partial', 'final', 'deposit'];

function paymentCol(alias, column) {
  return alias ? `${alias}.${column}` : column;
}

/**
 * Customer/order/sale cash in — exclude vendor purchase payments.
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {string} [alias] Table alias (e.g. `p` for `payments as p`). Pass `''` when the query has no alias.
 */
export function excludePurchasePayments(qb, alias = 'p') {
  return qb.whereNull(paymentCol(alias, 'purchase_id'));
}

/**
 * Vendor purchase bill payments (cash out).
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {string} [alias] Table alias (e.g. `p` for `payments as p`). Pass `''` when the query has no alias.
 */
export function onlyPurchasePayments(qb, alias = 'p') {
  return qb
    .whereNotNull(paymentCol(alias, 'purchase_id'))
    .whereIn(paymentCol(alias, 'category'), VENDOR_PAYMENT_CATEGORIES);
}

export function formatPurchasePaymentDetails(purchaseNumber, purchaseStatus) {
  const label = purchaseStatus ? String(purchaseStatus).toUpperCase() : 'ACTIVE';
  if (purchaseNumber) return `${purchaseNumber} - PAYMENT (PURCHASE - ${label})`;
  return 'PAYMENT (PURCHASE - ACTIVE)';
}
