import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchSessionMessage, getRuntimeSession, invokeSessionHook, reconnectDelay, resumeSession,
  shouldReconnectAfterDisconnect, stopSession } from './baileysManager.js';
import { deactivateSessionRuntime } from './sessionLifecycle.js';

test('fake provider is called only after durable dispatch marker and never while disconnected', async () => {
  const events = [];
  const runtime = { status: 'connected', sock: { sendMessage: async (jid, content) => {
    events.push(['provider', jid, content.text]);
    return { id: 'fake-ack' };
  } } };
  const marker = async () => { events.push(['marker']); };
  assert.deepEqual(await dispatchSessionMessage(runtime, 'fixture', { text: 'hello' }, marker), { id: 'fake-ack' });
  assert.deepEqual(events, [['marker'], ['provider', 'fixture', 'hello']]);
  events.length = 0;
  await assert.rejects(dispatchSessionMessage({ ...runtime, status: 'reconnecting' }, 'fixture', {}, marker), /not connected/);
  assert.deepEqual(events, []);
  await assert.rejects(dispatchSessionMessage(runtime, 'fixture', {}, async () => { throw new Error('stale lease'); }), /stale lease/);
  assert.deepEqual(events, []);
});

test('fake provider timeout after durable marker is propagated without internal resend', async () => {
  let calls = 0;
  let marked = false;
  const runtime = { status: 'connected', sock: { sendMessage: async () => {
    calls += 1;
    assert.equal(marked, true);
    throw new Error('acknowledgment timeout');
  } } };
  await assert.rejects(dispatchSessionMessage(runtime, 'fixture', {}, async () => { marked = true; }), /timeout/);
  assert.equal(calls, 1);
});

test('manual logout while the durable marker awaits prevents any provider send', async () => {
  let release;
  let calls = 0;
  const sock = { sendMessage: async () => { calls += 1; } };
  const runtime = { status: 'connected', sock };
  const pending = dispatchSessionMessage(runtime, 'fixture', {},
    () => new Promise((resolve) => { release = resolve; }));
  assert.equal(deactivateSessionRuntime(runtime), sock);
  assert.equal(runtime.status, 'disconnected');
  release();
  await assert.rejects(pending, /session changed before sending/);
  assert.equal(calls, 0);
});

test('a replaced socket or superseded shop session cannot send after an async marker', async () => {
  let calls = 0;
  const sock = { sendMessage: async () => { calls += 1; } };
  const runtime = { status: 'connected', sock };
  await assert.rejects(dispatchSessionMessage(runtime, 'fixture', {}, async () => {
    runtime.sock = { sendMessage: sock.sendMessage };
  }), /session changed/);
  await assert.rejects(dispatchSessionMessage(runtime, 'fixture', {}, async () => {}, () => false), /session changed/);
  assert.equal(calls, 0);
});

test('WhatsApp reconnect delay applies bounded jitter', () => {
  assert.equal(reconnectDelay(1, 0), 3200);
  assert.equal(reconnectDelay(1, 1), 4800);
});

test('a failed persistence hook does not interrupt the reconnect control flow', async () => {
  let retryReached = false;
  const persisted = await invokeSessionHook(async () => { throw new Error('temporary database outage'); });
  retryReached = true;
  assert.equal(persisted, false);
  assert.equal(retryReached, true);
  let message;
  assert.equal(await invokeSessionHook((value) => { message = value; }, 'reconnected'), true);
  assert.equal(message, 'reconnected');
});

test('WhatsApp reconnect delay caps exponential backoff at five minutes', () => {
  assert.equal(reconnectDelay(100, 0.5), 300000);
  assert.equal(reconnectDelay(100, 1), 300000);
  assert.equal(reconnectDelay(-5, 0.5), 2000);
});

test('WhatsApp reconnects after every unexpected close and stops only for provider logout', () => {
  const loggedOut = 401;
  assert.equal(shouldReconnectAfterDisconnect(undefined, loggedOut), true);
  assert.equal(shouldReconnectAfterDisconnect(428, loggedOut), true);
  assert.equal(shouldReconnectAfterDisconnect(500, loggedOut), true);
  assert.equal(shouldReconnectAfterDisconnect(loggedOut, loggedOut), false);
});

test('background resume cannot undo a manual logout even with a stale persisted reconnect list', async () => {
  const shopId = 'fake-manually-stopped-shop';
  await stopSession(shopId);
  assert.equal(await resumeSession(shopId), null);
  assert.equal(getRuntimeSession(shopId), null);
});
