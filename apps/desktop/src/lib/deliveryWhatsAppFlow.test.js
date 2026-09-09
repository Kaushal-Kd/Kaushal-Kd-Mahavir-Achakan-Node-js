import assert from 'node:assert/strict';
import test from 'node:test';

import { runDeliveryWhatsAppFlow } from './deliveryWhatsAppFlow.js';
import { applyUpdatesToStageDraft } from './orderChecklistMerge.js';

function orderFixture() {
  return {
    id: 'order-1',
    order_number: 'BK-001',
    items: [
      {
        id: 'item-1',
        product_id: 'p1',
        name_snapshot: 'Sherwani',
        qty: 1,
        stage_flags: { item_to_collect: true, prepared: true, delivered: false },
      },
      {
        id: 'item-2',
        product_id: 'p2',
        name_snapshot: 'Suit',
        qty: 1,
        stage_flags: { item_to_collect: true, prepared: true, delivered: false },
      },
    ],
    accessories: [],
  };
}

async function executeFlow(updates, results = {}) {
  const orderBefore = orderFixture();
  const stageDraftAfter = applyUpdatesToStageDraft(orderBefore, updates);
  const orderAfter = {
    ...orderBefore,
    items: orderBefore.items.map((item) => ({
      ...item,
      stage_flags: stageDraftAfter[`item:${item.id}`],
    })),
  };
  const calls = [];
  const result = await runDeliveryWhatsAppFlow({
    wa: { runOutbound: async (payload) => {
      calls.push(payload);
      return results[payload.templateKey] || { sent: true };
    } },
    orderBefore,
    orderAfter,
    orderId: orderBefore.id,
    stageUpdates: updates,
    stageDraftAfter,
    actionLabel: 'Delivery saved',
    buildDocument: (_order, _kind, options) => ({ lineKeys: options.lineKeys }),
  });
  return { calls, result };
}

test('partial delivery sends the selected-item PDF without a final bill message', async () => {
  const { calls, result } = await executeFlow([
    { item_type: 'item', item_id: 'item-1', field: 'delivered', value: true },
  ]);
  assert.deepEqual(result, ['DELIVERY_PRODUCT_LIST']);
  assert.deepEqual(calls.map((call) => call.templateKey), ['DELIVERY_PRODUCT_LIST']);
  assert.deepEqual(calls[0].document.lineKeys, ['item:item-1']);
});

test('skipped or failed delivery messages are not reported as sent', async () => {
  const { calls, result } = await executeFlow([
    { item_type: 'item', item_id: 'item-1', field: 'delivered', value: true },
    { item_type: 'item', item_id: 'item-2', field: 'delivered', value: true },
  ], {
    DELIVERY_PRODUCT_LIST: { sent: false, skipped: true },
    BILL_DELIVER: { sent: false, reason: 'not_connected' },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(result, []);
});

test('bill can be sent after user skips the optional item PDF', async () => {
  const { result } = await executeFlow([
    { item_type: 'item', item_id: 'item-1', field: 'delivered', value: true },
    { item_type: 'item', item_id: 'item-2', field: 'delivered', value: true },
  ], { DELIVERY_PRODUCT_LIST: { sent: false, skipped: true } });
  assert.deepEqual(result, ['BILL_DELIVER']);
});

test('completed delivery sends the item PDF before the bill-delivered message', async () => {
  const { calls, result } = await executeFlow([
    { item_type: 'item', item_id: 'item-1', field: 'delivered', value: true },
    { item_type: 'item', item_id: 'item-2', field: 'delivered', value: true },
  ]);
  assert.deepEqual(result, ['DELIVERY_PRODUCT_LIST', 'BILL_DELIVER']);
  assert.deepEqual(calls.map((call) => call.templateKey), [
    'DELIVERY_PRODUCT_LIST',
    'BILL_DELIVER',
  ]);
  assert.ok(calls.every((call) => call.forcePrompt === true));
});

test('optimistic completion cannot send a final bill when the committed response is partial', async () => {
  const before = orderFixture();
  const updates = before.items.map((row) => ({
    item_id: row.id, item_type: 'item', field: 'delivered', value: true,
  }));
  const after = structuredClone(before);
  after.items[0].stage_flags.delivered = true;
  const calls = [];
  await runDeliveryWhatsAppFlow({
    wa: { runOutbound: async (payload) => { calls.push(payload); return { sent: true }; } },
    orderBefore: before, orderAfter: after, orderId: before.id,
    stageUpdates: updates, stageDraftAfter: applyUpdatesToStageDraft(before, updates),
    buildDocument: (_order, _kind, options) => options,
  });
  assert.deepEqual(calls.map((row) => row.templateKey), ['DELIVERY_PRODUCT_LIST']);
  assert.deepEqual(calls[0].document.lineKeys, ['item:item-1']);
});

test('repeated already-delivered updates do not resend a product list', async () => {
  const before = orderFixture();
  before.items.forEach((row) => { row.stage_flags.delivered = true; });
  const result = await runDeliveryWhatsAppFlow({
    wa: { runOutbound: async () => { assert.fail('must not prompt or send'); } },
    orderBefore: before, orderAfter: structuredClone(before), orderId: before.id,
    stageUpdates: [{ item_id: 'item-1', item_type: 'item', field: 'delivered', value: true }],
  });
  assert.deepEqual(result, []);
});

test('failed item-list send is not counted, and the bill prompt still follows it', async () => {
  const { calls, result } = await executeFlow([
    { item_type: 'item', item_id: 'item-1', field: 'delivered', value: true },
    { item_type: 'item', item_id: 'item-2', field: 'delivered', value: true },
  ], { DELIVERY_PRODUCT_LIST: { sent: false, reason: 'error', error: 'ack uncertain' } });
  assert.deepEqual(calls.map((row) => row.templateKey), ['DELIVERY_PRODUCT_LIST', 'BILL_DELIVER']);
  assert.deepEqual(result, ['BILL_DELIVER']);
});
