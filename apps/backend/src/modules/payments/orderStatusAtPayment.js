/**
 * Read current order status when recording a payment.
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string|null|undefined} orderId
 * @returns {Promise<string|null>}
 */
export async function readOrderStatusForPayment(trx, shopId, orderId) {
  const oid = String(orderId || '').trim();
  if (!oid) return null;
  const row = await trx('orders').where({ id: oid, shop_id: shopId }).select('status').first();
  return row?.status ? String(row.status).trim() : null;
}

/**
 * Insert payment row; captures order_status_at_payment when order_id is set.
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {Record<string, unknown>} paymentRow
 */
export function paymentStageFromOrderStatus(status) {
  if (['partially_returned', 'returned', 'closed'].includes(status)) return 'return';
  if (status === 'delivered') return 'delivery';
  return 'booking';
}

export async function insertOrderPayment(trx, shopId, paymentRow, stage = null) {
  const row = { ...paymentRow };
  // Only the originating server operation may supply the immutable payment stage.
  delete row.payment_stage;
  if (row.order_id) {
    row.order_status_at_payment = await readOrderStatusForPayment(trx, shopId, row.order_id);
    if (stage != null && !['booking', 'delivery', 'return'].includes(stage)) {
      throw new Error('Invalid originating payment stage');
    }
    row.payment_stage = stage || paymentStageFromOrderStatus(row.order_status_at_payment);
  }
  await trx('payments').insert(row);
}
