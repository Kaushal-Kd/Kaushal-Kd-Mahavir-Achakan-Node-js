import assert from 'node:assert/strict';
import { test } from 'node:test';

import { insertOrderPayment, paymentStageFromOrderStatus } from './orderStatusAtPayment.js';
import { sqlPaymentOrderStatusExpr } from '../reports/orderPaymentReportHelpers.js';

test('generic payments use the actual current phase, not preparation as delivery', () => {
  for (const status of ['booked', 'in_preparation', 'ready_for_delivery']) {
    assert.equal(paymentStageFromOrderStatus(status), 'booking');
  }
  assert.equal(paymentStageFromOrderStatus('delivered'), 'delivery');
  for (const status of ['partially_returned', 'returned', 'closed']) {
    assert.equal(paymentStageFromOrderStatus(status), 'return');
  }
});

test('originating delivery/return phase survives insertion before status propagation', async () => {
  const inserted = [];
  const trx = (table) => table === 'payments'
    ? { insert: async (row) => inserted.push(row) }
    : { where: () => ({ select: () => ({ first: async () => ({ status: 'in_preparation' }) }) }) };
  for (const stage of ['booking', 'delivery', 'return']) {
    await insertOrderPayment(trx, 'shop', { order_id: 'bill', payment_stage: 'invalid' }, stage);
    assert.equal(inserted.at(-1).payment_stage, stage);
  }
  await insertOrderPayment(trx, 'shop', { order_id: 'bill', payment_stage: 'return' });
  assert.equal(inserted.at(-1).payment_stage, 'booking');
  await insertOrderPayment(trx, 'shop', { payment_stage: 'return' });
  assert.equal(inserted.at(-1).payment_stage, undefined);
});

test('SQL payment-stage filters prefer immutable stages over later milestones', () => {
  const sql = sqlPaymentOrderStatusExpr();
  for (const stage of ['booking', 'delivery', 'return']) {
    assert.ok(sql.indexOf(`p.payment_stage = '${stage}'`) < sql.indexOf('o.returned_at'));
  }
});
