import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDeliverySettlementSyncQueue,
  isTransientSettlementSyncError,
} from './deliverySettlementSyncQueue.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

function httpError(status, message, data) {
  const error = new Error(message || `HTTP ${status}`);
  error.response = { status, data };
  return error;
}

function createHarness({ online = true, storage = memoryStorage() } = {}) {
  let scope = { shopId: 'shop-a', userId: 'user-a' };
  let authenticated = true;
  let currentTime = Date.parse('2026-08-15T10:00:00.000Z');
  let submit = async () => ({ ok: true });
  let submitReturn = async () => ({ ok: true });
  let submitOrderEdit = async () => ({ ok: true });
  let submitReassignment = async () => ({ ok: true });
  let submitCashReconciliation = async () => ({ ok: true });
  let submitGstConversion = async () => ({ ok: true });
  let nextTimerId = 1;
  const timers = new Map();
  const calls = [];
  const returnCalls = [];
  const orderEditCalls = [];
  const invalidated = [];
  const reassignmentCalls = [];
  const cashReconciliationCalls = [];
  const gstConversionCalls = [];
  const financeInvalidations = [];

  const service = createDeliverySettlementSyncQueue({
    storage,
    storageKey: 'test-queue',
    getScope: () => scope,
    hasAuth: () => authenticated,
    submitSettlement: async (orderId, payload) => {
      calls.push({ orderId, payload });
      return submit(orderId, payload);
    },
    submitReturnSettlement: async (orderId, payload) => {
      returnCalls.push({ orderId, payload });
      return submitReturn(orderId, payload);
    },
    submitOrderEdit: async (orderId, payload) => {
      orderEditCalls.push({ orderId, payload });
      return submitOrderEdit(orderId, payload);
    },
    submitReassignment: async (orderId, reassignmentPayload) => {
      reassignmentCalls.push({ orderId, payload: reassignmentPayload });
      return submitReassignment(orderId, reassignmentPayload);
    },
    submitCashReconciliation: async (cashPayload) => {
      cashReconciliationCalls.push(cashPayload);
      return submitCashReconciliation(cashPayload);
    },
    submitGstConversion: async (sourceId, conversionPayload) => {
      gstConversionCalls.push({ sourceId, payload: conversionPayload });
      return submitGstConversion(sourceId, conversionPayload);
    },
    invalidateOrder: async (orderId) => invalidated.push(orderId),
    invalidateFinance: async (entry) => financeInvalidations.push(entry.entity),
    createId: () => 'generated-id',
    now: () => currentTime,
    retryDelays: [100, 200],
    initialOnline: online,
    setTimer: (callback, delay) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });

  return {
    service,
    calls,
    returnCalls,
    orderEditCalls,
    setSubmitOrderEdit: (next) => { submitOrderEdit = next; },
    setSubmitReturn: (next) => { submitReturn = next; },
    invalidated,
    reassignmentCalls,
    cashReconciliationCalls,
    gstConversionCalls,
    financeInvalidations,
    timers,
    setScope: (next) => {
      scope = next;
    },
    setAuthenticated: (next) => {
      authenticated = next;
    },
    setSubmit: (next) => {
      submit = next;
    },
    setSubmitReassignment: (next) => {
      submitReassignment = next;
    },
    setSubmitCashReconciliation: (next) => {
      submitCashReconciliation = next;
    },
    setSubmitGstConversion: (next) => {
      submitGstConversion = next;
    },
    advance: (amount) => {
      currentTime += amount;
    },
  };
}

const payload = { idempotency_key: 'same-idempotency-key', receive_amount: 10 };

for (const kind of ['delivery', 'return', 'order_edit']) {
  test(`${kind} timeout after account/shop switch keeps original command scope and payload`, async () => {
    const harness = createHarness();
    let rejectRequest;
    const deferred = () => new Promise((_resolve, reject) => { rejectRequest = reject; });
    const method = kind === 'delivery' ? 'submitOrQueueDeliverySettlement'
      : kind === 'return' ? 'submitOrQueueReturnSettlement' : 'submitOrderEdit';
    harness[kind === 'delivery' ? 'setSubmit' : kind === 'return' ? 'setSubmitReturn' : 'setSubmitOrderEdit'](deferred);
    const original = { ...payload, stage_updates: [{ item_id: 'line-a', value: true }] };
    const submission = harness.service[method]('order-1', original);
    harness.setScope({ shopId: 'shop-b', userId: 'user-b' });
    original.receive_amount = 99;
    original.stage_updates[0].value = false;
    rejectRequest(httpError(503, 'Delayed response'));
    assert.equal((await submission).queued, true);
    assert.deepEqual(harness.service.getEntries(), [], 'old action must not appear under the new identity');
    harness.setScope({ shopId: 'shop-a', userId: 'user-a' });
    const [entry] = harness.service.getEntries();
    assert.equal(entry.shopId, 'shop-a');
    assert.equal(entry.userId, 'user-a');
    assert.equal(entry.payload.receive_amount, 10);
    assert.equal(entry.payload.stage_updates[0].value, true);
    harness.service.destroy();
  });
}

test('saved request key cannot overwrite payload, entity, order or scope', async () => {
  const harness = createHarness({ online: false });
  await harness.service.submitOrQueueReturnSettlement('order-1', payload);
  await assert.rejects(harness.service.submitOrQueueReturnSettlement('order-1', { ...payload, receive_amount: 20 }), /existing saved action/);
  await assert.rejects(harness.service.submitOrQueueDeliverySettlement('order-1', payload), /existing saved action/);
  await assert.rejects(harness.service.submitOrQueueReturnSettlement('order-2', payload), /existing saved action/);
  harness.setScope({ shopId: 'shop-b', userId: 'user-b' });
  await assert.rejects(harness.service.submitOrQueueReturnSettlement('order-1', payload), /existing saved action/);
  harness.setScope({ shopId: 'shop-a', userId: 'user-a' });
  assert.deepEqual(harness.service.getEntries()[0].payload, payload);
  await harness.service.submitOrQueueReturnSettlement('order-1', { receive_amount: 10, idempotency_key: payload.idempotency_key });
  assert.equal(harness.service.getEntries().length, 1, 'equivalent request may be retried with reordered properties');
  await assert.rejects(harness.service.retry(payload.idempotency_key, { receive_amount: 50 }), /existing saved action/);
  harness.service.destroy();
});

test('offline booking edit replays through order-edit transport with original tokens', async () => {
  const harness = createHarness({ online: false });
  const edit = { idempotency_key: 'edit-1', expected_product_lines: [{ item_id: 'line-1', expected_line_version: 2 }] };
  await harness.service.submitOrderEdit('order-1', edit, { orderNumber: 'B-1' });
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.orderEditCalls, [{ orderId: 'order-1', payload: edit }]);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('earlier return backoff blocks later future delivery until return sync succeeds', async () => {
  const harness = createHarness({ online: false });
  let returns = 0;
  harness.setSubmitReturn(async () => {
    returns += 1;
    if (returns === 1) throw httpError(503, 'return temporarily unavailable');
    return { ok: true };
  });
  await harness.service.submitOrQueueReturnSettlement('source-order', { ...payload, idempotency_key: 'damage-return' });
  await harness.service.submitOrQueueDeliverySettlement('future-order', { ...payload, idempotency_key: 'future-delivery' });
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.returnCalls.length, 1);
  assert.equal(harness.calls.length, 0, 'future delivery must not overtake the failed return');
  assert.equal(harness.service.getEntries()[1].blockedBy, 'damage-return');
  const timer = [...harness.timers.values()][0];
  assert.equal(timer.delay, 100, 'retry timer follows the first command, not the later ready command');
  harness.advance(100);
  timer.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.returnCalls.length, 2);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('review-required earlier command blocks later actions and timers until explicitly removed', async () => {
  const harness = createHarness({ online: false });
  harness.setSubmitReturn(async () => { throw httpError(409, 'return needs review'); });
  await harness.service.submitOrQueueReturnSettlement('source-order', { ...payload, idempotency_key: 'review-return' });
  await harness.service.submitOrQueueDeliverySettlement('future-order', { ...payload, idempotency_key: 'later-delivery' });
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.timers.size, 0, 'blocked later work must not create a zero-delay retry loop');
  assert.match(harness.service.getEntries()[1].blockedReason, /reviewed/);
  await harness.service.retry('later-delivery');
  assert.equal(harness.calls.length, 0, 'retrying later work cannot skip unresolved earlier work');
  assert.equal(harness.service.remove('review-return'), true);
  await harness.service.sync();
  assert.equal(harness.calls.length, 1);
  harness.service.destroy();
});

test('online return is durably saved before dispatch and later delivery cannot bypass the in-flight command', async () => {
  const storage = memoryStorage();
  const harness = createHarness({ storage });
  let finishReturn;
  harness.setSubmitReturn(() => new Promise((resolve) => { finishReturn = resolve; }));
  const first = harness.service.submitOrQueueReturnSettlement('source-order', { ...payload, idempotency_key: 'inflight-return' });
  const persisted = JSON.parse(storage.getItem('test-queue'));
  assert.equal(persisted[0].id, 'inflight-return');
  assert.equal(harness.service.getState().syncing, true);
  const later = await harness.service.submitOrQueueDeliverySettlement('future-order', { ...payload, idempotency_key: 'queued-delivery' });
  assert.equal(later.queued, true);
  assert.equal(harness.calls.length, 0);
  await harness.service.sync();
  assert.equal(harness.returnCalls.length, 1, 'manual sync cannot duplicate an in-flight direct request');
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.service.remove('inflight-return'), false);
  finishReturn({ ok: true });
  assert.equal((await first).queued, false);
  await harness.service.sync();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('online commands also wait behind a review-required action', async () => {
  const harness = createHarness();
  harness.setSubmitReturn(async () => { throw httpError(409, 'stale return'); });
  await assert.rejects(harness.service.submitOrQueueReturnSettlement('source-order', { ...payload, idempotency_key: 'failed-return' }), /stale return/);
  assert.equal(harness.service.getEntries()[0].status, 'failed');
  const delivery = await harness.service.submitOrQueueDeliverySettlement('future-order', { ...payload, idempotency_key: 'blocked-delivery' });
  assert.equal(delivery.queued, true);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.timers.size, 0);
  harness.service.destroy();
});

test('failed durable local storage prevents the first external command', async () => {
  const harness = createHarness({ storage: { getItem: () => null, setItem: () => { throw new Error('storage full'); } } });
  await assert.rejects(harness.service.submitOrQueueReturnSettlement('source-order', payload), /storage full/);
  assert.equal(harness.returnCalls.length, 0);
  assert.equal(harness.service.getEntries().length, 0, 'failed persistence must not leave a replayable in-memory command');
  harness.service.destroy();
});

test('sync error policy queues network, 408, 429, and 5xx failures only', () => {
  assert.equal(isTransientSettlementSyncError(new Error('offline')), true);
  assert.equal(isTransientSettlementSyncError(httpError(408)), true);
  assert.equal(isTransientSettlementSyncError(httpError(429)), true);
  assert.equal(isTransientSettlementSyncError(httpError(503)), true);
  assert.equal(isTransientSettlementSyncError(httpError(400)), false);
  assert.equal(isTransientSettlementSyncError(httpError(409)), false);
});

test('offline return replay uses return endpoint and preserves command identity', async () => {
  const harness = createHarness({ online: false });
  const result = await harness.service.submitOrQueueReturnSettlement('order-1', payload);
  assert.equal(result.queued, true);
  assert.equal(harness.service.getEntries()[0].entity, 'return_settlement');
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.returnCalls.length, 1);
  assert.equal(harness.returnCalls[0].payload.idempotency_key, payload.idempotency_key);
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('return conflict requires review without automatic retries', async () => {
  const harness = createHarness({ online: false });
  harness.setSubmitReturn(async () => { throw httpError(409, 'Changed line'); });
  await harness.service.submitOrQueueReturnSettlement('order-1', payload);
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.service.getEntries()[0].status, 'failed');
  assert.equal(harness.timers.size, 0);
  harness.service.destroy();
});

test('transient online failure retries automatically with the same idempotency key', async () => {
  const harness = createHarness();
  let attempt = 0;
  harness.setSubmit(async () => {
    attempt += 1;
    if (attempt === 1) throw httpError(503, 'busy');
    return { ok: true };
  });

  const result = await harness.service.submitOrQueueDeliverySettlement('order-1', payload, {
    orderNumber: 'B-0001',
  });
  assert.equal(result.queued, true);
  assert.equal(harness.service.getEntries()[0].orderNumber, 'B-0001');
  assert.equal(harness.timers.size, 1);
  const timer = [...harness.timers.values()][0];
  assert.equal(timer.delay, 100);

  harness.advance(100);
  timer.callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.service.getEntries().length, 0);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].payload.idempotency_key, payload.idempotency_key);
  assert.deepEqual(harness.invalidated, ['order-1']);
  harness.service.destroy();
});

test('business-rule failure remains visible until manual retry succeeds', async () => {
  const harness = createHarness();
  harness.service.enqueueDeliverySettlement('order-2', payload, { orderNumber: 'B-0002' });
  harness.setSubmit(async () => {
    throw httpError(409, 'conflict', { message: 'Accessory unavailable' });
  });

  await harness.service.sync();
  assert.equal(harness.service.getState().failed, 1);
  assert.equal(harness.service.getEntries()[0].error, 'Accessory unavailable');
  assert.equal(harness.timers.size, 0);

  harness.setSubmit(async () => ({ ok: true }));
  await harness.service.retry(payload.idempotency_key);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('queue replay is isolated to the same shop and user and entries can be removed', async () => {
  const harness = createHarness({ online: false });
  await harness.service.submitOrQueueDeliverySettlement('order-3', payload);

  harness.setScope({ shopId: 'shop-b', userId: 'user-a' });
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.service.getState().queued, 0);

  harness.setScope({ shopId: 'shop-a', userId: 'user-a' });
  await harness.service.sync();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.service.getEntries().length, 0);

  harness.service.setOnline(false);
  await harness.service.submitOrQueueDeliverySettlement('order-4', {
    ...payload,
    idempotency_key: 'remove-me',
  });
  assert.equal(harness.service.remove('remove-me'), true);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('an active replay stops before the next item when the shop scope changes', async () => {
  const harness = createHarness({ online: false });
  await harness.service.submitOrQueueDeliverySettlement('order-a', {
    ...payload,
    idempotency_key: 'scope-a-1',
  });
  await harness.service.submitOrQueueDeliverySettlement('order-b', {
    ...payload,
    idempotency_key: 'scope-a-2',
  });

  let releaseFirst;
  harness.setSubmit(
    () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      })
  );
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.length, 1);

  harness.setScope({ shopId: 'shop-b', userId: 'user-a' });
  releaseFirst({ ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.length, 1);

  harness.setSubmit(async () => ({ ok: true }));
  harness.setScope({ shopId: 'shop-a', userId: 'user-a' });
  await harness.service.sync();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('salesman reassignment queues offline and replays as the same scoped set operation', async () => {
  const harness = createHarness({ online: false });
  const reassignment = {
    order_item_ids: ['line-1', 'line-2'],
    sales_person_id: 'salesman-2',
  };
  const result = await harness.service.submitOrQueueSalesmanReassignment('order-5', reassignment, {
    orderNumber: 'B-0005',
  });
  assert.equal(result.queued, true);
  assert.equal(harness.service.getEntries()[0].entity, 'salesman_reassignment');
  assert.equal(harness.service.getEntries()[0].orderNumber, 'B-0005');

  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.reassignmentCalls, [{ orderId: 'order-5', payload: reassignment }]);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('permanent reassignment conflicts stay visible for manual recovery', async () => {
  const harness = createHarness({ online: false });
  await harness.service.submitOrQueueSalesmanReassignment('order-6', {
    order_item_ids: ['line-3'],
    sales_person_id: 'salesman-3',
  });
  harness.setSubmitReassignment(async () => {
    throw httpError(409, 'conflict', { message: 'Selected line no longer exists' });
  });
  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.service.getState().failed, 1);
  assert.equal(harness.service.getEntries()[0].error, 'Selected line no longer exists');
  harness.service.destroy();
});

test('cash reconciliation queues offline without persisting the Master Password', async () => {
  const harness = createHarness({ online: false });
  const cashPayload = {
    payment_account_id: 'cash-counter-1',
    business_date: '2026-08-15',
    counted_closing: 1200,
    idempotency_key: 'cash-close-1',
    admin_password: 'must-not-be-stored',
  };

  const result = await harness.service.submitOrQueueCashReconciliation(cashPayload, {
    label: 'Ground floor cash',
  });
  assert.equal(result.queued, true);
  const [entry] = harness.service.getEntries();
  assert.equal(entry.entity, 'cash_reconciliation');
  assert.equal(entry.orderNumber, 'Ground floor cash');
  assert.equal(entry.payload.idempotency_key, 'cash-close-1');
  assert.equal('admin_password' in entry.payload, false);

  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.cashReconciliationCalls.length, 1);
  assert.equal(harness.cashReconciliationCalls[0].idempotency_key, 'cash-close-1');
  assert.equal('admin_password' in harness.cashReconciliationCalls[0], false);
  assert.deepEqual(harness.financeInvalidations, ['cash_reconciliation']);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});

test('GST conversion requires a one-time Master Password on manual retry', async () => {
  const harness = createHarness({ online: false });
  const conversionPayload = {
    source_type: 'booking',
    idempotency_key: 'gst-conversion-1',
    reason: 'Customer requested Kaccha Bill',
    admin_password: 'must-not-be-stored',
  };
  harness.setSubmitGstConversion(async (_sourceId, submittedPayload) => {
    if (!submittedPayload.admin_password) {
      throw httpError(400, 'password required', { message: 'Master Password is required' });
    }
    return { converted: true };
  });

  await harness.service.submitOrQueueGstConversion('order-7', conversionPayload, {
    label: 'B-0007',
    requiresMasterPassword: true,
  });
  const queued = harness.service.getEntries()[0];
  assert.equal(queued.entity, 'gst_conversion');
  assert.equal(queued.requiresMasterPassword, true);
  assert.equal('admin_password' in queued.payload, false);

  harness.service.setOnline(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.service.getState().failed, 1);
  assert.equal(harness.service.getEntries()[0].error, 'Master Password is required');

  await harness.service.retry('gst-conversion-1', { admin_password: 'one-time-password' });
  assert.equal(harness.gstConversionCalls.length, 2);
  assert.equal(harness.gstConversionCalls[1].payload.admin_password, 'one-time-password');
  assert.deepEqual(harness.financeInvalidations, ['gst_conversion']);
  assert.equal(harness.service.getEntries().length, 0);
  harness.service.destroy();
});
