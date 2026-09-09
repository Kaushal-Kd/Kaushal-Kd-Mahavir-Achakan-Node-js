/**
 * SQL helpers for payment-time order status in finance reports.
 */

/** True when this payment is not the earliest on the linked order. */
export function sqlFollowUpOrderPaymentExpr() {
  return `(p.created_at > (
    SELECT MIN(p2.created_at)
    FROM payments p2
    WHERE p2.order_id = p.order_id
      AND p2.shop_id = p.shop_id
      AND p2.is_deleted = 0
  ))`;
}

/** Raw SQL expression: payment-time order status (booked | delivered | returned). */
export function sqlPaymentOrderStatusExpr() {
  const followUp = sqlFollowUpOrderPaymentExpr();
  return `(CASE
    WHEN p.payment_stage = 'booking' THEN 'booked'
    WHEN p.payment_stage = 'delivery' THEN 'delivered'
    WHEN p.payment_stage = 'return' THEN 'returned'
    WHEN o.returned_at IS NOT NULL AND p.created_at >= o.returned_at THEN 'returned'
    WHEN o.delivered_at IS NOT NULL AND p.created_at >= o.delivered_at THEN 'delivered'
    WHEN o.packed_at IS NOT NULL AND p.created_at >= o.packed_at THEN 'delivered'
    WHEN p.order_status_at_payment = 'ready_for_delivery' THEN 'delivered'
    WHEN p.order_status_at_payment IN ('partially_returned', 'closed') THEN 'returned'
    WHEN p.order_status_at_payment = 'cancelled' THEN 'cancelled'
    WHEN p.order_status_at_payment IS NOT NULL AND TRIM(p.order_status_at_payment) <> ''
      AND p.order_status_at_payment NOT IN ('booked', 'delivered', 'returned') THEN 'booked'
    WHEN ${followUp} AND o.status IN ('partially_returned', 'returned', 'closed') THEN 'returned'
    WHEN ${followUp}
      AND o.status IN ('ready_for_delivery', 'delivered', 'partially_returned', 'returned', 'closed')
    THEN 'delivered'
    WHEN ${followUp} AND o.delivered_at IS NOT NULL
      AND DATE(DATE_ADD(p.created_at, INTERVAL 330 MINUTE)) = DATE(DATE_ADD(o.delivered_at, INTERVAL 330 MINUTE))
    THEN 'delivered'
    ELSE 'booked'
  END)`;
}

export function sqlFollowUpOrderPaymentSelect(knex) {
  return knex.raw(`${sqlFollowUpOrderPaymentExpr()} as is_follow_up_order_payment`);
}

/** SQL: BOOKING - Booked / Delivered / Returned from a status column expression. */
export function sqlBookingPartFromPaymentStatus(statusColumnSql) {
  return `CONCAT(
    'BOOKING - ',
    CASE ${statusColumnSql}
      WHEN 'booked' THEN 'Booked'
      WHEN 'delivered' THEN 'Delivered'
      WHEN 'returned' THEN 'Returned'
      WHEN 'cancelled' THEN 'Cancelled'
      ELSE ${statusColumnSql}
    END
  )`;
}

/** Alias used in SELECT lists. */
export function sqlPaymentOrderStatusSelect(knex) {
  return knex.raw(`${sqlPaymentOrderStatusExpr()} as payment_order_status`);
}

export function sqlBookingPartForPayment() {
  return sqlBookingPartFromPaymentStatus(sqlPaymentOrderStatusExpr());
}
