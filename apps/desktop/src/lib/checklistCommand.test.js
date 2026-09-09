import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeliverySettlementSyncQueue } from '../services/deliverySettlementSyncQueue.js';

import { buildChecklistCommandPayload, createChecklistCommandSubmitter, findPendingChecklistCommand } from './checklistCommand.js';

function storage() {
  const saved = new Map();
  return { getItem: (key) => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
}

function fixture({ online = false, localStorage = storage() } = {}) {
  let scope = { shopId: 'shop-a', userId: 'user-a' };
  let sender = async (_id, body) => ({ ok: true, data: { id: 'order-1', checklist_state_token: 'b'.repeat(64) }, replayed: body.replayed || false });
  let counter = 0;
  const calls = [];
  const saved = [];
  const queue = createDeliverySettlementSyncQueue({
    storage: localStorage, storageKey: 'commands', initialOnline: online,
    getScope: () => scope, hasAuth: () => true, createId: () => `command-${++counter}`,
    setTimer: () => 1, clearTimer: () => {},
    submitChecklistCommand: async (id, body) => { calls.push({ id, body }); return sender(id, body); },
  });
  const submit = createChecklistCommandSubmitter({ queue, afterSave: async (id, order) => saved.push({ id, order }) });
  return { queue, submit, calls, saved, localStorage, setSender: (next) => { sender = next; }, setScope: (next) => { scope = next; } };
}

const order = { id: 'order-1', order_number: 'B-1', checklist_state_token: 'a'.repeat(64) };
const updates = [{ item_id: 'line-1', item_type: 'item', field: 'prepared', value: true }];
const options = () => ({ order: { ...order }, stageUpdates: structuredClone(updates) });

test('builder captures original state token and maps combined assessment without mutable draft references', () => {
  const input = { ...options(), combinedCharge: { amount: 40, remarks: 'Damage', accountId: 'cash-1' }, adminPassword: 'memory-only' };
  const body = buildChecklistCommandPayload('order-1', input);
  input.order.checklist_state_token = 'b'.repeat(64);
  input.stageUpdates[0].value = false;
  assert.equal(body.expected_state_token, 'a'.repeat(64));
  assert.equal(body.stage_updates[0].value, true);
  assert.deepEqual(body.combined_assessment, { amount: 40, remarks: 'Damage', payment_account_id: 'cash-1' });
  assert.equal(body.admin_password, 'memory-only');
  assert.throws(() => buildChecklistCommandPayload('order-1', { ...options(), order: { id: 'order-1' } }), /original checklist state/);
  assert.throws(() => buildChecklistCommandPayload('wrong-order', options()), /original checklist state/);
});

test('offline command survives reload with patches and original token, never persisting Master Password', async () => {
  const first = fixture();
  const input = { ...options(), conditionUpdates: [{ item_id: 'line-2', item_type: 'accessory', damaged: true }], adminPassword: 'do-not-store' };
  assert.deepEqual(await first.submit('order-1', input), { queued: true, order: null, replayed: false });
  const pending = findPendingChecklistCommand(first.queue.getEntries(), 'order-1');
  assert.equal(pending.payload.expected_state_token, order.checklist_state_token);
  assert.equal(pending.payload.condition_updates[0].damaged, true);
  assert.equal(pending.requiresMasterPassword, true);
  assert.equal('admin_password' in pending.payload, false);
  assert.equal(first.localStorage.getItem('commands').includes('do-not-store'), false);
  first.queue.destroy();
  const reloaded = fixture({ localStorage: first.localStorage });
  await reloaded.submit('order-1', input);
  assert.equal(reloaded.queue.getEntries().length, 1);
  assert.equal(reloaded.queue.getEntries()[0].id, pending.id);
  assert.equal(reloaded.calls.length, 0);
  reloaded.queue.destroy();
});

test('only one pending checklist command per order; identical retry preserves failed review state', async () => {
  const f = fixture({ online: true });
  f.setSender(async () => { const error = new Error('snapshot changed'); error.response = { status: 409 }; throw error; });
  await assert.rejects(f.submit('order-1', options()), /snapshot changed/);
  assert.equal(f.queue.getEntries()[0].status, 'failed');
  assert.equal((await f.submit('order-1', options())).queued, true);
  assert.equal(f.queue.getEntries()[0].status, 'failed');
  await assert.rejects(f.submit('order-1', { ...options(), stageUpdates: [{ ...updates[0], value: false }] }), /already has a saved checklist action/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.queue.getEntries().length, 1);
  f.queue.destroy();
});

test('timeout retries reuse command key and replay outcome is reported accurately', async () => {
  const f = fixture({ online: true });
  f.setSender(async () => { throw new Error('network timeout'); });
  const input = options();
  assert.equal((await f.submit('order-1', input)).queued, true);
  const originalKey = f.calls[0].body.idempotency_key;
  f.setSender(async () => ({ ok: true, data: { ...order, checklist_state_token: 'b'.repeat(64) }, replayed: true }));
  await f.queue.sync();
  assert.equal(f.calls[1].body.idempotency_key, originalKey);
  const replayed = await f.submit('order-1', input);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.queued, false);
  assert.equal(replayed.order.checklist_state_token, 'b'.repeat(64));
  assert.equal(f.calls[2].body.idempotency_key, originalKey);
  f.queue.destroy();
});

test('account switch cannot apply an old response to active account cache; keys remain scoped', async () => {
  const f = fixture({ online: true });
  let finish;
  f.setSender(() => new Promise((resolve) => { finish = resolve; }));
  const inFlight = f.submit('order-1', options());
  f.setScope({ shopId: 'shop-b', userId: 'user-b' });
  finish({ ok: true, data: { ...order }, replayed: false });
  await inFlight;
  assert.equal(f.saved.length, 0);
  f.setSender(async () => ({ ok: true, data: { ...order }, replayed: false }));
  await f.submit('order-1', options());
  assert.notEqual(f.calls[0].body.idempotency_key, f.calls[1].body.idempotency_key);
  f.queue.destroy();
});

test('local storage failure prevents checklist network dispatch', async () => {
  const f = fixture({ online: true, localStorage: { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } } });
  await assert.rejects(f.submit('order-1', options()), /storage unavailable/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.queue.getEntries().length, 0);
  f.queue.destroy();
});
