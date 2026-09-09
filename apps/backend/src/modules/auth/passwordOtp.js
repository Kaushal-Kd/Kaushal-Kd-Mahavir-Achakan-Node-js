import crypto from 'node:crypto';

import { badRequest, forbidden } from '../../utils/errors.js';

/** Persist failed attempts before rejecting; throwing inside the transaction undoes the lockout. */
export async function confirmPasswordOtp(database, { requester, challengeId, otp, newPassword }, {
  digestOtp,
  hashPassword,
}) {
  const result = await database.transaction(async (trx) => {
    const challenge = await trx('password_otp_challenges')
      .where({ id: challengeId }).forUpdate().first();
    if (!challenge) throw badRequest('Invalid or expired OTP challenge');
    if (challenge.requested_by_user_id !== requester.id) throw forbidden('Invalid or expired OTP challenge');
    if (challenge.consumed_at || new Date(challenge.expires_at) <= new Date()) {
      throw badRequest('OTP has expired. Request a new one.');
    }
    const attempts = Number(challenge.attempts || 0);
    if (attempts >= 5) throw badRequest('Too many incorrect OTP attempts');
    const actual = Buffer.from(digestOtp(challenge.id, otp), 'hex');
    const expected = Buffer.from(challenge.otp_hash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      await trx('password_otp_challenges')
        .where({ id: challenge.id }).update({ attempts: attempts + 1 });
      return { rejected: attempts + 1 >= 5 ? 'Too many incorrect OTP attempts' : 'Incorrect OTP' };
    }
    await trx('users').where({ id: challenge.target_user_id }).update({
      password_hash: await hashPassword(newPassword),
      must_change_password: false,
      password_changed_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    await trx('password_otp_challenges')
      .where({ id: challenge.id }).update({ consumed_at: trx.fn.now() });
    await trx('refresh_tokens').where({ user_id: challenge.target_user_id })
      .whereNull('revoked_at').update({ revoked_at: trx.fn.now() });
    await trx('auth_sessions').where({ user_id: challenge.target_user_id, status: 'active' }).update({
      status: 'revoked',
      revoked_at: trx.fn.now(),
      revoke_reason: 'Password changed',
      updated_at: trx.fn.now(),
    });
    return { target_user_id: challenge.target_user_id };
  });
  // OTP validation is not JWT expiry: a 401 would make the desktop retry and consume another attempt.
  if (result.rejected) throw badRequest(result.rejected);
  return result;
}
