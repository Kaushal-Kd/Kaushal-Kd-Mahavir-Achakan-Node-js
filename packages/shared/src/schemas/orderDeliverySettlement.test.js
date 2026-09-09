import assert from 'node:assert/strict';
import test from 'node:test';

import { orderDeliverySettlementBodySchema } from './order.js';

const ID = '20c68b5f-e5de-44a7-9ca3-a8b31feee0a0';

function validPayload() {
  return {
    idempotency_key: ID,
    discount_total: 100,
    deposit_amount: 500,
    security_status: 'paid',
    security_amount: 500,
    security_account_id: 'c18217ad-f971-4324-a30a-aa6bd1022be7',
    receive_amount: 900,
    payment_account_id: '8fdca90f-759b-485a-923d-4dfd47c9c739',
    payment_date: '2026-08-15',
    delivery_remark: 'Delivered at venue',
    stage_updates: [
      { item_id: ID, item_type: 'item', field: 'delivered', value: true },
    ],
  };
}

test('delivery settlement accepts the complete atomic command', () => {
  const result = orderDeliverySettlementBodySchema.safeParse(validPayload());
  assert.equal(result.success, true);
});

test('delivery settlement requires ledger accounts for positive amounts', () => {
  const payload = validPayload();
  payload.security_account_id = null;
  payload.payment_account_id = null;
  const result = orderDeliverySettlementBodySchema.safeParse(payload);
  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path[0]).sort(),
    ['payment_account_id', 'security_account_id']
  );
});

test('delivery settlement allows 500 stage changes but rejects 501', () => {
  const payload = validPayload();
  payload.stage_updates = Array.from({ length: 500 }, () => ({
    item_id: ID,
    item_type: 'item',
    field: 'delivered',
    value: true,
  }));
  assert.equal(orderDeliverySettlementBodySchema.safeParse(payload).success, true);
  payload.stage_updates.push(payload.stage_updates[0]);
  assert.equal(orderDeliverySettlementBodySchema.safeParse(payload).success, false);
});
