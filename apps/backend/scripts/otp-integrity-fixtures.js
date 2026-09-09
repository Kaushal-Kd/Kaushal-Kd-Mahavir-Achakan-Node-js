import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { confirmPasswordOtp } from '../src/modules/auth/passwordOtp.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

/** Only invoked by the explicitly disposable database integration runner. */
export async function runOtpIntegrityFixtures({ db }) {
  const database = String(db.client.config.connection.database || '');
  assert.match(database, /(test|disposable|temporary|tmp)/i, 'OTP fixtures require a disposable database');
  assert.equal(process.env.WRS_TEST_MYSQL_INTEGRATION, '1');
  const userId = randomUUID();
  const digestOtp = (id, otp) => createHash('sha256').update(`${id}:${otp}`).digest('hex');
  const dependencies = { digestOtp, hashPassword };
  const originalHash = await hashPassword('Synthetic-old-password-1!');
  const newPassword = 'Synthetic-new-password-2!';
  const expiresAt = new Date(Date.now() + 600_000);
  await db('users').insert({ id: userId, name: 'OTP integration admin', role: 'shop_admin',
    email: `otp-${userId}@example.test`, password_hash: originalHash });
  const challenge = async (overrides = {}) => {
    const id = randomUUID();
    await db('password_otp_challenges').insert({ id, target_user_id: userId,
      requested_by_user_id: userId, otp_hash: digestOtp(id, '123456'), expires_at: expiresAt,
      ...overrides });
    return id;
  };
  const confirm = (challengeId, otp = '123456', requester = { id: userId }) =>
    confirmPasswordOtp(db, { requester, challengeId, otp, newPassword }, dependencies);
  try {
    const lockedId = await challenge();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await assert.rejects(confirm(lockedId, '999999'), /OTP/);
      const saved = await db('password_otp_challenges').where({ id: lockedId }).first();
      assert.equal(Number(saved.attempts), attempt);
    }
    await assert.rejects(confirm(lockedId), /Too many/);

    const concurrentId = await challenge();
    const failures = await Promise.allSettled(Array.from({ length: 8 }, () => confirm(concurrentId, '999999')));
    assert.ok(failures.every((result) => result.status === 'rejected'));
    assert.equal(Number((await db('password_otp_challenges').where({ id: concurrentId }).first()).attempts), 5);

    const expiredId = await challenge({ expires_at: new Date(Date.now() - 60_000) });
    await assert.rejects(confirm(expiredId), /expired/);
    const successfulId = await challenge();
    await assert.rejects(confirm(successfulId, '123456', { id: randomUUID() }), /expired/);
    assert.equal((await db('users').where({ id: userId }).first()).password_hash, originalHash);
    const sessionId = randomUUID();
    const tokenId = randomUUID();
    await db('auth_sessions').insert({ id: sessionId, user_id: userId, device_id: 'otp-test', expires_at: expiresAt });
    await db('refresh_tokens').insert({ id: tokenId, user_id: userId, token_hash: randomUUID(), expires_at: expiresAt });
    await confirm(successfulId);
    assert.equal(await verifyPassword(newPassword, (await db('users').where({ id: userId }).first()).password_hash), true);
    assert.equal((await db('auth_sessions').where({ id: sessionId }).first()).status, 'revoked');
    assert.ok((await db('refresh_tokens').where({ id: tokenId }).first()).revoked_at);
    await assert.rejects(confirm(successfulId), /expired/);
  } finally {
    await db('users').where({ id: userId }).delete();
  }
}
