import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { confirmPasswordOtp } from './passwordOtp.js';

const digestOtp = (id, otp) => createHash('sha256').update(`${id}:${otp}`).digest('hex');
const dependencies = { digestOtp, hashPassword: async (value) => `hashed:${value}` };
const payload = { requester: { id: 'actor' }, challengeId: 'challenge', otp: '123456', newPassword: 'new-secret' };

function databaseFixture(overrides = {}) {
  let state = {
    password_otp_challenges: [{ id: 'challenge', target_user_id: 'admin', requested_by_user_id: 'actor',
      otp_hash: digestOtp('challenge', '123456'), expires_at: new Date(Date.now() + 600_000),
      attempts: 0, consumed_at: null, ...overrides }],
    users: [{ id: 'admin', password_hash: 'old-hash' }],
    refresh_tokens: [{ user_id: 'admin', revoked_at: null }, { user_id: 'other', revoked_at: null }],
    auth_sessions: [{ user_id: 'admin', status: 'active' }],
  };
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    transaction(callback) {
      const run = queue.then(async () => {
        const draft = structuredClone(state);
        function trx(table) {
          const predicates = [];
          const matches = () => draft[table].filter((row) => predicates.every((fn) => fn(row)));
          return {
            where(values) { predicates.push((row) => Object.entries(values).every(([k, v]) => row[k] === v)); return this; },
            whereNull(key) { predicates.push((row) => row[key] == null); return this; },
            forUpdate() { return this; },
            async first() { return matches()[0]; },
            async update(values) { for (const row of matches()) Object.assign(row, values); },
          };
        }
        trx.fn = { now: () => new Date() };
        const result = await callback(trx);
        state = draft;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

test('incorrect OTP attempts commit before validation failure, without triggering JWT-refresh retries', async () => {
  const database = databaseFixture();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await assert.rejects(confirmPasswordOtp(database, { ...payload, otp: '999999' }, dependencies),
      (error) => error.statusCode === 400 && /OTP/.test(error.message));
    assert.equal(database.read().password_otp_challenges[0].attempts, attempt);
  }
  await assert.rejects(confirmPasswordOtp(database, payload, dependencies), /Too many/);
  assert.equal(database.read().users[0].password_hash, 'old-hash');
});

test('concurrent incorrect OTP attempts serialize without lost increments', async () => {
  const database = databaseFixture();
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
    confirmPasswordOtp(database, { ...payload, otp: '999999' }, dependencies)));
  assert.ok(outcomes.every((outcome) => outcome.status === 'rejected'));
  assert.equal(database.read().password_otp_challenges[0].attempts, 5);
});

test('successful OTP consumes the challenge and revokes only the target sessions', async () => {
  const database = databaseFixture();
  assert.deepEqual(await confirmPasswordOtp(database, payload, dependencies), { target_user_id: 'admin' });
  const state = database.read();
  assert.equal(state.users[0].password_hash, 'hashed:new-secret');
  assert.ok(state.password_otp_challenges[0].consumed_at);
  assert.ok(state.refresh_tokens[0].revoked_at);
  assert.equal(state.refresh_tokens[1].revoked_at, null);
  assert.equal(state.auth_sessions[0].status, 'revoked');
  await assert.rejects(confirmPasswordOtp(database, payload, dependencies), /expired/);
});

test('expired challenges and other requesters cannot mutate the password or attempts', async () => {
  for (const [database, request, statusCode] of [
    [databaseFixture({ expires_at: new Date(0) }), payload, 400],
    [databaseFixture(), { ...payload, requester: { id: 'other' } }, 403],
  ]) {
    await assert.rejects(confirmPasswordOtp(database, request, dependencies),
      (error) => error.statusCode === statusCode && /expired/.test(error.message));
    assert.equal(database.read().users[0].password_hash, 'old-hash');
    assert.equal(database.read().password_otp_challenges[0].attempts, 0);
  }
});

test('a failure changing the password rolls back consumption and session changes', async () => {
  const database = databaseFixture();
  await assert.rejects(confirmPasswordOtp(database, payload, {
    ...dependencies, hashPassword: async () => { throw new Error('hash failure'); },
  }), /hash failure/);
  assert.equal(database.read().password_otp_challenges[0].consumed_at, null);
  assert.equal(database.read().auth_sessions[0].status, 'active');
});
