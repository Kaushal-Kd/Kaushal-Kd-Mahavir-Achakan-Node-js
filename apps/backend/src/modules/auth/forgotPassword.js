import crypto from 'node:crypto';

import { v4 as uuid } from 'uuid';

import { env } from '../../config/env.js';
import knex from '../../db/knex.js';
import { sendForgotPasswordOtpEmail } from '../../lib/email.js';
import { badRequest } from '../../utils/errors.js';
import { hashPassword } from '../../utils/password.js';
import { confirmPasswordOtp } from './passwordOtp.js';

function normalizeLoginPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

export const FORGOT_PASSWORD_ADMIN_ROLES = ['super_admin', 'shop_admin'];
export const FORGOT_PASSWORD_CONTACT_ADMIN =
  'Only shop admin and super admin can reset the password here. Contact your administrator.';
export const FORGOT_PASSWORD_PURPOSE = 'forgot_password';

function otpDigest(challengeId, otp) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${challengeId}:${otp}`).digest('hex');
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

export function classifyForgotPasswordUser(user) {
  if (!user || !user.is_active) {
    return { allow: false, code: 'contact_admin', message: FORGOT_PASSWORD_CONTACT_ADMIN };
  }
  if (!FORGOT_PASSWORD_ADMIN_ROLES.includes(user.role)) {
    return { allow: false, code: 'contact_admin', message: FORGOT_PASSWORD_CONTACT_ADMIN };
  }
  if (!String(user.email || '').includes('@')) {
    return {
      allow: false,
      code: 'no_email',
      message: 'This administrator account has no email. Contact your administrator.',
    };
  }
  return { allow: true };
}

export async function findUserByLoginIdentity(identity) {
  const raw = String(identity || '').trim();
  const phone = normalizeLoginPhone(raw);
  let user = phone ? await knex('users').where({ login_phone: phone }).first() : null;
  if (!user && raw.includes('@')) {
    user = await knex('users').whereRaw('LOWER(email) = ?', [raw.toLowerCase()]).first();
  }
  return user || null;
}

async function loadForgotChallenge(challengeId) {
  const challenge = await knex('password_otp_challenges').where({ id: challengeId }).first();
  if (!challenge || challenge.purpose !== FORGOT_PASSWORD_PURPOSE) {
    throw badRequest('Invalid or expired OTP challenge');
  }
  return challenge;
}

export async function requestForgotPasswordOtp(
  { identity },
  { sendEmail = sendForgotPasswordOtpEmail } = {}
) {
  const user = await findUserByLoginIdentity(identity);
  const eligibility = classifyForgotPasswordUser(user);
  if (!eligibility.allow) throw badRequest(eligibility.message);

  const recent = await knex('password_otp_challenges')
    .where({ target_user_id: user.id, purpose: FORGOT_PASSWORD_PURPOSE })
    .where('created_at', '>', new Date(Date.now() - 60_000))
    .first('id');
  if (recent) throw badRequest('Please wait one minute before requesting another OTP');

  const id = uuid();
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresInMinutes = 10;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
  await knex('password_otp_challenges').insert({
    id,
    target_user_id: user.id,
    requested_by_user_id: user.id,
    purpose: FORGOT_PASSWORD_PURPOSE,
    otp_hash: otpDigest(id, otp),
    expires_at: expiresAt,
  });
  try {
    await sendEmail({
      to: user.email,
      name: user.name,
      otp,
      expiresInMinutes,
    });
  } catch (error) {
    await knex('password_otp_challenges').where({ id }).del();
    throw error;
  }
  return { challenge_id: id, email: maskEmail(user.email), expires_at: expiresAt };
}

export async function verifyForgotPasswordOtp({ challengeId, otp }) {
  const result = await knex.transaction(async (trx) => {
    const challenge = await trx('password_otp_challenges')
      .where({ id: challengeId })
      .forUpdate()
      .first();
    if (!challenge || challenge.purpose !== FORGOT_PASSWORD_PURPOSE) {
      throw badRequest('Invalid or expired OTP challenge');
    }
    if (challenge.consumed_at || new Date(challenge.expires_at) <= new Date()) {
      throw badRequest('OTP has expired. Request a new one.');
    }
    const attempts = Number(challenge.attempts || 0);
    if (attempts >= 5) throw badRequest('Too many incorrect OTP attempts');
    const actual = Buffer.from(otpDigest(challenge.id, otp), 'hex');
    const expected = Buffer.from(challenge.otp_hash, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      await trx('password_otp_challenges')
        .where({ id: challenge.id })
        .update({ attempts: attempts + 1 });
      return { rejected: attempts + 1 >= 5 ? 'Too many incorrect OTP attempts' : 'Incorrect OTP' };
    }
    return { ok: true };
  });
  if (result.rejected) throw badRequest(result.rejected);
  return result;
}

export async function resetForgotPassword({ challengeId, otp, newPassword }) {
  const challenge = await loadForgotChallenge(challengeId);
  return confirmPasswordOtp(
    knex,
    {
      requester: { id: challenge.requested_by_user_id },
      challengeId,
      otp,
      newPassword,
    },
    {
      digestOtp: otpDigest,
      hashPassword,
    }
  );
}
