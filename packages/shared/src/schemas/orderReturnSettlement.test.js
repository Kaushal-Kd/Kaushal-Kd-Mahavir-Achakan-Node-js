import assert from 'node:assert/strict';
import test from 'node:test';

import { orderReturnSettlementBodySchema } from './order.js';

const ID = '20c68b5f-e5de-44a7-9ca3-a8b31feee0a0';
const PAYMENT_ID = '8fdca90f-759b-485a-923d-4dfd47c9c739';
const SECURITY_ID = 'c18217ad-f971-4324-a30a-aa6bd1022be7';

function validPayload() {
  return {
    idempotency_key: ID,
    discount_total: 100,
    security_refund_amount: 500,
    refund_via: 'security',
    refund_payment_account_id: null,
    refund_security_account_id: SECURITY_ID,
    receive_amount: 900,
    payment_account_id: PAYMENT_ID,
    payment_date: '2026-08-17',
    return_remark: 'Returned at shop',
    security_charge_remarks: 'No deductions',
    charge_payment_account_id: PAYMENT_ID,
    condition_updates: [
      {
        item_id: ID,
        item_type: 'accessory',
        condition: 'damage',
        condition_qty: 1,
        charge_amount: 250,
      },
    ],
    reminder: { reminder_date: '2026-08-18', reminder_time: '9:00 AM' },
    stage_updates: [{ item_id: ID, item_type: 'accessory', field: 'received', value: true }],
  };
}

test('return settlement accepts the complete atomic command', () => {
  assert.equal(orderReturnSettlementBodySchema.safeParse(validPayload()).success, true);
});

test('condition assessment never defaults to collection or retention', () => {
  const parsed = orderReturnSettlementBodySchema.parse(validPayload());
  assert.equal(parsed.condition_collect_amount, 0);
  assert.equal(parsed.condition_retain_amount, 0);
  assert.equal(orderReturnSettlementBodySchema.safeParse({ ...validPayload(), idempotency_key: undefined }).success, false);
  assert.equal(orderReturnSettlementBodySchema.safeParse({ ...validPayload(), condition_collect_amount: 50, charge_payment_account_id: null }).success, false);
});

test('return settlement requires the selected refund and receive accounts', () => {
  const payload = validPayload();
  payload.refund_security_account_id = null;
  payload.payment_account_id = null;
  const result = orderReturnSettlementBodySchema.safeParse(payload);
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map((issue) => issue.path[0]).sort(), [
    'payment_account_id',
    'refund_security_account_id',
  ]);
});

test('return settlement supports bank/cash refunds and optional reminders', () => {
  const payload = validPayload();
  payload.refund_via = 'bank_cash';
  payload.refund_security_account_id = null;
  payload.refund_payment_account_id = PAYMENT_ID;
  payload.reminder = null;
  assert.equal(orderReturnSettlementBodySchema.safeParse(payload).success, true);
});

test('return settlement rejects invalid condition kinds and negative charges', () => {
  const invalidKind = validPayload();
  invalidKind.condition_updates[0].condition = 'damaged';
  assert.equal(orderReturnSettlementBodySchema.safeParse(invalidKind).success, false);

  const negative = validPayload();
  negative.condition_updates[0].charge_amount = -1;
  assert.equal(orderReturnSettlementBodySchema.safeParse(negative).success, false);
});

test('return settlement requires a positive affected quantity when it is provided', () => {
  const payload = validPayload();
  payload.condition_updates[0].condition_qty = 0;
  assert.equal(orderReturnSettlementBodySchema.safeParse(payload).success, false);
});

test('return settlement allows 500 stage changes but rejects 501', () => {
  const payload = validPayload();
  payload.stage_updates = Array.from({ length: 500 }, () => ({
    item_id: ID,
    item_type: 'accessory',
    field: 'received',
    value: true,
  }));
  assert.equal(orderReturnSettlementBodySchema.safeParse(payload).success, true);
  payload.stage_updates.push(payload.stage_updates[0]);
  assert.equal(orderReturnSettlementBodySchema.safeParse(payload).success, false);
});
