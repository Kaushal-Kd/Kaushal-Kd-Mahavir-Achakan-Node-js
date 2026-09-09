import assert from 'node:assert/strict';
import test from 'node:test';

import {
  connectSessionSocket,
  createScopedSessionOperations,
  deactivateSessionRuntime,
  drainSessionPersistence,
  queueRuntimeSessionHook,
  queueSessionCredentialsSave,
} from './sessionLifecycle.js';

test('manual logout while reconnect persistence is pending prevents creation of a replacement socket', async () => {
  let release;
  let current = true;
  let created = 0;
  const runtime = { sock: null, status: 'reconnecting' };
  const connecting = connectSessionSocket(runtime, () => { created += 1; return {}; }, {}, {
    beforeConnect: () => new Promise((resolve) => { release = resolve; }),
    isCurrent: () => current,
  });
  current = false;
  deactivateSessionRuntime(runtime);
  release();
  assert.equal(await connecting, null);
  assert.equal(created, 0);
  assert.equal(runtime.sock, null);
});

test('normal reconnect installs exactly one socket after persistence', async () => {
  const calls = [];
  const sock = {};
  const runtime = {};
  assert.equal(await connectSessionSocket(runtime, () => { calls.push('connect'); return sock; }, {}, {
    beforeConnect: () => { calls.push('persist'); }, isCurrent: () => true,
  }), sock);
  assert.equal(runtime.sock, sock);
  assert.deepEqual(calls, ['persist', 'connect']);
});

test('logout drains active credential writes and stale events cannot recreate auth files', async () => {
  let current = true;
  let release;
  const calls = [];
  const runtime = {};
  const save = () => { calls.push('save'); return new Promise((resolve) => { release = resolve; }); };
  queueSessionCredentialsSave(runtime, save, () => current);
  await Promise.resolve();
  assert.deepEqual(calls, ['save']);
  current = false;
  const drained = queueSessionCredentialsSave(runtime, save, () => current);
  release();
  await drained;
  calls.push('remove auth');
  await queueSessionCredentialsSave(runtime, save, () => current);
  assert.deepEqual(calls, ['save', 'remove auth']);
});

test('a failed credential write reports its failure without poisoning subsequent writes', async () => {
  const runtime = {};
  let errors = 0;
  let writes = 0;
  await queueSessionCredentialsSave(runtime, async () => { throw new Error('disk failure'); },
    () => true, () => { errors += 1; });
  await queueSessionCredentialsSave(runtime, async () => { writes += 1; }, () => true);
  assert.equal(errors, 1);
  assert.equal(writes, 1);
});

test('start waits for old logout/auth cleanup in the same shop, without blocking other shops', async () => {
  const run = createScopedSessionOperations();
  const events = [];
  let release;
  const logout = run('shop-1', async () => {
    events.push('old logout');
    await new Promise((resolve) => { release = resolve; });
    events.push('remove old auth');
  });
  const start = run('shop-1', async () => { events.push('new login'); });
  await run('shop-2', async () => { events.push('other shop login'); });
  assert.deepEqual(events, ['old logout', 'other shop login']);
  release();
  await Promise.all([logout, start]);
  assert.deepEqual(events, ['old logout', 'other shop login', 'remove old auth', 'new login']);
});

test('failed lifecycle operation does not prevent a later explicit start', async () => {
  const run = createScopedSessionOperations();
  const failed = run('shop', async () => { throw new Error('logout failure'); });
  const next = run('shop', async () => 'started');
  await assert.rejects(failed, /logout failure/);
  assert.equal(await next, 'started');
});

test('new runtime waits for previous credential and status persistence; stale reconnect hooks cannot undo logout', async () => {
  const events = [];
  let releaseCredentials;
  let releaseStatus;
  let current = true;
  const runtime = {};
  queueSessionCredentialsSave(runtime, async () => {
    await new Promise((resolve) => { releaseCredentials = resolve; });
    events.push('old credentials saved');
  }, () => true);
  queueRuntimeSessionHook(runtime, async () => {
    await new Promise((resolve) => { releaseStatus = resolve; });
    events.push('old reconnect persisted');
  }, () => current);
  await Promise.resolve();
  current = false;
  queueRuntimeSessionHook(runtime, async () => { events.push('stale reconnect persisted'); }, () => current);
  const replacing = drainSessionPersistence(runtime).then(() => { events.push('new auth loaded'); });
  releaseCredentials();
  await Promise.resolve();
  assert.ok(!events.includes('new auth loaded'));
  releaseStatus();
  await replacing;
  assert.deepEqual(events, ['old credentials saved', 'old reconnect persisted', 'new auth loaded']);
});

test('accepted credentials survive a same-tick temporary close before reconnect loads auth', async () => {
  const sock = {};
  const runtime = { sock, status: 'connected' };
  let writes = 0;
  const isCurrentRuntime = () => true;
  if (isCurrentRuntime() && runtime.sock === sock) {
    queueSessionCredentialsSave(runtime, async () => { writes += 1; }, isCurrentRuntime);
  }
  runtime.sock = null;
  runtime.status = 'reconnecting';
  await drainSessionPersistence(runtime);
  assert.equal(writes, 1);
});
