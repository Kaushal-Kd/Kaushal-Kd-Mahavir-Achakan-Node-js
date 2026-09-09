import { round2 } from '@wrs/shared';

/**
 * Recompute orders.paid_amount, balance, payment_status from non-deleted payments.
 * Advance / partial / final increase paid; refunds subtract. Deposit rows are excluded from paid/balance.
 */
export async function recomputeOrderPayment(trx, shopId, orderId) {
  const [order, agg] = await Promise.all([
    trx('orders').where({ id: orderId, shop_id: shopId }).select('total_amount').first(),
    trx('payments')
      .where({ order_id: orderId, is_deleted: false })
      .select(
        trx.raw("COALESCE(SUM(CASE WHEN category IN ('advance','partial','final','credit_note_apply') THEN amount ELSE 0 END), 0) as income"),
        trx.raw("COALESCE(SUM(CASE WHEN category IN ('refund','credit_note_issue') THEN amount ELSE 0 END), 0) as expense")
      )
      .first(),
  ]);
  if (!order) return;
  const paid = Number(agg?.income || 0) - Number(agg?.expense || 0);
  const totalAmount = Number(order.total_amount);
  const balance = round2(totalAmount - paid);
  let status = 'pending';
  if (paid <= 0) status = 'pending';
  else if (paid < totalAmount) status = 'partial';
  else if (paid === totalAmount) status = 'paid';
  else status = 'overpaid';
  await trx('orders').where({ id: orderId }).update({
    paid_amount: round2(paid),
    balance,
    payment_status: status,
    updated_at: trx.fn.now(),
  });
}
