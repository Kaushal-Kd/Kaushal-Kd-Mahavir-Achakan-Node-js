import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSettlementReplay } from './settlementCommand.js';

const payload = { idempotency_key: 'key', receive_amount: 10, stage_updates: [] };
const input = {
  shopId: 'shop',
  orderId: 'order',
  userId: 'user',
  entity: 'return_settlement',
  payload,
};
const row = {
  shop_id: 'shop',
  entity_id: 'order',
  user_id: 'user',
  entity: 'return_settlement',
  status: 'synced',
  payload: JSON.stringify({ request: payload, payments: { rent_payment_id: 'receipt' } }),
};

test('replayed command accepts reordered keys and returns the original receipt', () => {
  const saved = assertSettlementReplay(row, {
    ...input,
    payload: { stage_updates: [], receive_amount: 10, idempotency_key: 'key' },
  });
  assert.equal(saved.payments.rent_payment_id, 'receipt');
});

test('key cannot be reused for different money, user, shop, bill or operation', () => {
  for (const patch of [
    { payload: { ...payload, receive_amount: 20 } },
    { userId: 'other' },
    { shopId: 'other' },
    { orderId: 'other' },
    { entity: 'delivery_settlement' },
  ]) {
    assert.throws(() => assertSettlementReplay(row, { ...input, ...patch }), { statusCode: 409 });
  }
  assert.throws(() => assertSettlementReplay({ ...row, status: 'processing' }, input), {
    statusCode: 409,
  });
});
