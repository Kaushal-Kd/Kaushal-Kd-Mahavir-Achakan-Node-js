import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliverySettlementSyncQueue } from './deliverySettlementSyncQueue.js';

function setup(storage, scope, online, submitGstIssuance, submitShopIpCommand) {
  return createDeliverySettlementSyncQueue({
    storage,
    storageKey: 'commands',
    getScope: () => scope.value,
    hasAuth: () => true,
    createId: () => 'test-id',
    initialOnline: online,
    setTimer: () => 1,
    clearTimer: () => {},
    submitGstIssuance,
    submitShopIpCommand,
  });
}
function storage() {
  let data = null;
  return {
    getItem: () => data,
    setItem: (_key, value) => {
      data = value;
    },
  };
}

test('offline GST issuance survives reload, preserves its exact payload and cannot cross user/shop scope', async () => {
  const stored = storage();
  const scope = { value: { shopId: 'shop-a', userId: 'actor-a' } };
  const calls = [];
  const body = {
    idempotency_key: 'gst-one',
    max_amount: 10000,
    invoices: [{ source_id: 'bill', percentage: 20, source_fingerprint: 'original' }],
  };
  let queue = setup(stored, scope, false, async (payload) => {
    calls.push(payload);
  });
  assert.equal((await queue.submitOrQueueGstIssuance(body)).queued, true);
  assert.equal(calls.length, 0);
  assert.equal(queue.getEntries()[0].entity, 'gst_issuance');
  queue.destroy();
  scope.value = { shopId: 'shop-b', userId: 'actor-a' };
  queue = setup(stored, scope, true, async (payload) => {
    calls.push(payload);
  });
  await queue.sync();
  assert.equal(calls.length, 0);
  scope.value = { shopId: 'shop-a', userId: 'actor-b' };
  await queue.sync();
  assert.equal(calls.length, 0);
  scope.value = { shopId: 'shop-a', userId: 'actor-a' };
  await assert.rejects(queue.submitOrQueueGstIssuance({ ...body, max_amount: 15000 }));
  await queue.sync();
  assert.deepEqual(calls, [body]);
  assert.equal(queue.getEntries().length, 0);
  queue.destroy();
});

test('a stale IP command remains reviewable with its original revision and ranges', async () => {
  const stored = storage();
  const scope = { value: { shopId: 'shop-a', userId: 'admin' } };
  const calls = [];
  const body = {
    idempotency_key: 'ip-one',
    expected_revision: 3,
    policy: { kind: 'shop', enabled: true, allowed_ranges: ['127.0.0.1'] },
  };
  let queue = setup(stored, scope, false, null, null);
  await queue.submitOrQueueShopIpCommand('shop-a', body);
  queue.destroy();
  queue = setup(stored, scope, true, null, async (shop, payload) => {
    calls.push({ shop, payload });
    const error = new Error('IP policies changed');
    error.response = { status: 409 };
    throw error;
  });
  await queue.sync();
  assert.deepEqual(calls, [{ shop: 'shop-a', payload: body }]);
  assert.equal(queue.getEntries()[0].status, 'failed');
  assert.deepEqual(queue.getEntries()[0].payload, body);
  await queue.sync();
  assert.equal(calls.length, 1);
  queue.destroy();
});
