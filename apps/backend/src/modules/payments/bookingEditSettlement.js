import { bookingEditSettlementSchema, round2 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { getOrdinarySecurityHeld } from '../security-charges/ledgerService.js';
import { excludeDirectConditionPayments } from '../security-charges/ledgerPredicates.js';

import { assertLedgerRefs } from './ledgerRefs.js';
import { insertOrderPayment } from './orderStatusAtPayment.js';

export async function getOrdinarySecurityNet(trx, shopId, orderId) {
  const row = await trx('payments')
    .modify(excludeDirectConditionPayments)
    .where({ shop_id: shopId, order_id: orderId, is_deleted: false })
    .whereIn('category', ['deposit', 'deposit_refund'])
    .select(
      trx.raw(
        "COALESCE(SUM(CASE WHEN category = 'deposit' THEN amount ELSE -amount END),0) as amount"
      )
    )
    .first();
  return round2(Number(row?.amount || 0));
}

/** Must run inside the same READ COMMITTED transaction as the version-checked booking edit. */
export async function applyBookingEditPaymentsWithTrx(trx, shopId, orderId, input, userId) {
  if (!input) return [];
  const body = validate(bookingEditSettlementSchema, input);
  const order = await trx('orders')
    .where({ id: orderId, shop_id: shopId, is_deleted: false })
    .forUpdate()
    .first();
  if (!order) throw notFound('Order not found');
  if (
    body.deposit_amount !== undefined &&
    Math.abs(round2(body.deposit_amount) - Number(order.deposit_amount || 0)) > 0.009
  ) {
    throw conflict('Security Amount changed; refresh the booking');
  }
  const rows = [];
  if (body.advance_net !== undefined) {
    const totals = await trx('payments')
      .where({ shop_id: shopId, order_id: orderId, is_deleted: false })
      .select(
        trx.raw(
          "COALESCE(SUM(CASE WHEN category = 'advance' THEN amount WHEN category = 'refund' THEN -amount ELSE 0 END),0) as advance_net"
        ),
        trx.raw(
          "COALESCE(SUM(CASE WHEN category IN ('advance','partial','final','credit_note_apply') THEN amount WHEN category IN ('refund','credit_note_issue') THEN -amount ELSE 0 END),0) as paid"
        )
      )
      .first();
    const current = round2(Math.max(0, Number(totals?.advance_net || 0)));
    if (Math.abs(current - body.expected_advance_net) > 0.009)
      throw conflict('Advance receipts changed; refresh the booking');
    const delta = round2(body.advance_net - current);
    if (
      delta > 0 &&
      delta > Math.max(0, Number(order.total_amount || 0) - Number(totals?.paid || 0)) + 0.009
    ) {
      throw badRequest('Advance collection exceeds the pending bill amount');
    }
    if (delta < 0 && -delta > Math.max(0, Number(totals?.paid || 0)) + 0.009)
      throw badRequest('Advance refund exceeds received money');
    if (delta) {
      if (!body.payment_account_id)
        throw badRequest('Select the payment account for the advance adjustment');
      const source = await trx('payment_accounts')
        .where({ id: body.payment_account_id, shop_id: shopId, is_active: true })
        .first('account_group');
      if (
        !source ||
        !['bank accounts', 'cash accounts'].includes(
          String(source.account_group || '')
            .trim()
            .toLowerCase()
        )
      )
        throw badRequest('Select an active bank/cash account for the advance adjustment');
      rows.push({
        category: delta > 0 ? 'advance' : 'refund',
        amount: Math.abs(delta),
        payment_account_id: body.payment_account_id,
      });
    }
  }
  if (body.security_net !== undefined) {
    const current = await getOrdinarySecurityNet(trx, shopId, orderId);
    if (Math.abs(current - body.expected_security_net) > 0.009)
      throw conflict('Security receipts changed; refresh the booking');
    const delta = round2(body.security_net - current);
    if (
      delta > 0 &&
      (Number(order.deposit_amount || 0) <= 0 ||
        body.security_net > Number(order.deposit_amount) + 0.009)
    ) {
      throw badRequest('Set a sufficient Security Amount before collecting security');
    }
    if (delta < 0 && -delta > (await getOrdinarySecurityHeld(trx, shopId, orderId)) + 0.009) {
      throw badRequest(
        'Refund exceeds available booking security; use Manage funds for condition-held deposits'
      );
    }
    if (delta) {
      if (!body.security_account_id)
        throw badRequest('Select the security account for the security adjustment');
      rows.push({
        category: delta > 0 ? 'deposit' : 'deposit_refund',
        amount: Math.abs(delta),
        security_account_id: body.security_account_id,
      });
    }
  }
  if (rows.length && !order.customer_id)
    throw badRequest('Add a customer before recording payments');
  const paymentIds = [];
  for (const row of rows) {
    await assertLedgerRefs(trx, shopId, row);
    const id = uuid();
    await insertOrderPayment(trx, shopId, {
      ...row,
      id,
      shop_id: shopId,
      order_id: orderId,
      customer_id: order.customer_id,
      received_by: userId || null,
      payment_type: 'cash',
      payment_date: body.payment_date,
      notes: 'Explicit booking edit payment adjustment',
    });
    paymentIds.push(id);
  }
  return paymentIds;
}
