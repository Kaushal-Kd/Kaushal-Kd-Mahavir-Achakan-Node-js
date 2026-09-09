import crypto from 'node:crypto';

import { v4 as uuid } from 'uuid';

import { env } from '../../config/env.js';
import knex from '../../db/knex.js';
import { sendPasswordOtpEmail } from '../../lib/email.js';
import { unauthorized, badRequest, notFound, conflict, forbidden } from '../../utils/errors.js';
import { verifyPassword, hashPassword } from '../../utils/password.js';
import { assertIpAccess } from '../ip-whitelist/service.js';
import { confirmPasswordOtp } from './passwordOtp.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export function normalizeLoginPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

export async function getLoginMode() {
  const row = await knex('system_settings').where({ setting_key: 'auth.login_mode' }).first();
  return row?.setting_value === 'phone_only' ? 'phone_only' : 'dual_transition';
}

export async function login({ identity, password, device_id, device_name, ip }) {
  const rawIdentity = String(identity || '').trim();
  const phone = normalizeLoginPhone(rawIdentity);
  const mode = await getLoginMode();
  let user = phone ? await knex('users').where({ login_phone: phone }).first() : null;
  if (!user && mode === 'dual_transition' && rawIdentity.includes('@')) {
    user = await knex('users').whereRaw('LOWER(email) = ?', [rawIdentity.toLowerCase()]).first();
  }
  if (!user) throw unauthorized('Invalid phone number or password');
  if (!user.is_active) throw unauthorized('Account is inactive');

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw unauthorized('Account is temporarily locked. Try again later.');
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const failed = (user.failed_login_count || 0) + 1;
    const patch = { failed_login_count: failed };
    if (failed >= MAX_FAILED_LOGINS) {
      patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      patch.failed_login_count = 0;
    }
    await knex('users').where({ id: user.id }).update(patch);
    throw unauthorized('Invalid phone number or password');
  }

  await knex('users')
    .where({ id: user.id })
    .update({
      failed_login_count: 0,
      locked_until: null,
      last_login_at: knex.fn.now(),
      last_login_ip: ip || null,
      last_device_id: device_id || null,
      last_device_name: device_name || null,
    });

  const { hydrateUserPermissions } = await import('../../lib/authCache.js');
  await hydrateUserPermissions(user);
  const shops = await getUserShops(user.id, user.role);
  return { user: sanitizeUser(user), shops };
}

export async function getUserShops(userId, role) {
  if (role === 'super_admin') {
    return knex('shops').where({ is_active: true }).orderBy('shop_name');
  }
  const rows = await knex('shops')
    .join('users_shops', 'shops.id', 'users_shops.shop_id')
    .where('users_shops.user_id', userId)
    .andWhere('shops.is_active', true)
    .select(
      'shops.*',
      'users_shops.permissions as shop_permissions',
      'users_shops.permissions_overridden as shop_permissions_overridden',
      'users_shops.is_default as shop_is_default'
    )
    .orderBy('shops.shop_name');
  const { getPermissionsForRole } = await import('../roles/service.js');
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      shop_permissions: row.shop_permissions_overridden
        ? parseJson(row.shop_permissions)
        : await getPermissionsForRole(role, row.id),
    }))
  );
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

async function upsertAuthSession(db, { userId, deviceId, deviceName, ip, expiresAt = null }) {
  const resolvedDeviceId =
    String(deviceId || '')
      .trim()
      .slice(0, 128) || uuid();
  const days = parseExpiryDays(env.JWT_REFRESH_EXPIRY);
  const expiry = expiresAt || new Date(Date.now() + days * 86400000);
  await db('auth_sessions')
    .where({ user_id: userId, device_id: resolvedDeviceId, status: 'active' })
    .where('expires_at', '<=', db.fn.now())
    .update({ status: 'expired', updated_at: db.fn.now() });
  const active = await db('auth_sessions')
    .where({ user_id: userId, device_id: resolvedDeviceId, status: 'active' })
    .orderBy('last_used_at', 'desc')
    .first();
  if (active) {
    await db('auth_sessions')
      .where({ id: active.id })
      .update({
        device_name: deviceName || active.device_name,
        ip: ip || active.ip,
        login_at: db.fn.now(),
        last_used_at: db.fn.now(),
        expires_at: expiry,
        updated_at: db.fn.now(),
      });
    return active.id;
  }
  const id = uuid();
  await db('auth_sessions').insert({
    id,
    user_id: userId,
    device_id: resolvedDeviceId,
    device_name: deviceName || null,
    ip: ip || null,
    login_at: db.fn.now(),
    last_used_at: db.fn.now(),
    expires_at: expiry,
    status: 'active',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}

export async function createAuthSession(input) {
  return knex.transaction(async (trx) => {
    await trx('users').where({ id: input.userId }).forUpdate().first('id');
    return upsertAuthSession(trx, input);
  });
}

async function insertRefreshToken(db, { userId, deviceId, deviceName, ip, sessionId }) {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const id = uuid();
  const days = parseExpiryDays(env.JWT_REFRESH_EXPIRY);
  const expiresAt = new Date(Date.now() + days * 86400000);
  await db('refresh_tokens').insert({
    id,
    user_id: userId,
    session_id: sessionId || null,
    token_hash: hash,
    device_id: deviceId || null,
    device_name: deviceName || null,
    ip: ip || null,
    expires_at: expiresAt,
  });
  return { raw, expiresAt };
}

export async function createRefreshToken(input) {
  const result = await insertRefreshToken(knex, input);
  return result.raw;
}

export async function rotateRefreshToken({ userId, oldToken, deviceId, deviceName, ip }) {
  if (!oldToken) throw unauthorized('Refresh token missing');
  const hash = crypto.createHash('sha256').update(oldToken).digest('hex');
  return knex.transaction(async (trx) => {
    const query = trx('refresh_tokens').where({ token_hash: hash }).forUpdate();
    if (userId) query.andWhere({ user_id: userId });
    const row = await query.first();
    if (!row) throw unauthorized('Invalid refresh token');
    if (row.revoked_at) throw unauthorized('Refresh token revoked');
    if (new Date(row.expires_at) < new Date()) throw unauthorized('Refresh token expired');

    const ipAccess = await assertIpAccess(row.user_id, ip, trx);

    let sessionId = row.session_id;
    if (sessionId) {
      const session = await trx('auth_sessions')
        .where({ id: sessionId, user_id: row.user_id, status: 'active' })
        .forUpdate()
        .first();
      if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
        throw unauthorized('Device session revoked or expired');
      }
    } else {
      await trx('users').where({ id: row.user_id }).forUpdate().first('id');
      sessionId = await upsertAuthSession(trx, {
        userId: row.user_id,
        deviceId: deviceId || row.device_id,
        deviceName: deviceName || row.device_name,
        ip: ip || row.ip,
        expiresAt: row.expires_at,
      });
    }

    await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now() });
    const resolvedUserId = userId || row.user_id;
    const newToken = await insertRefreshToken(trx, {
      userId: resolvedUserId,
      deviceId: deviceId || row.device_id,
      deviceName: deviceName || row.device_name,
      ip: ip || row.ip,
      sessionId,
    });
    await trx('auth_sessions')
      .where({ id: sessionId })
      .update({
        last_used_at: trx.fn.now(),
        ip: ip || row.ip,
        expires_at: newToken.expiresAt,
        updated_at: trx.fn.now(),
      });
    return { token: newToken.raw, userId: resolvedUserId, sessionId, ipAccess };
  });
}

export async function revokeAllRefreshTokens(userId) {
  await knex('refresh_tokens').where({ user_id: userId }).update({ revoked_at: knex.fn.now() });
  await knex('auth_sessions').where({ user_id: userId, status: 'active' }).update({
    status: 'revoked',
    revoked_at: knex.fn.now(),
    revoke_reason: 'Password changed',
    updated_at: knex.fn.now(),
  });
}

export async function revokeAuthSession(sessionId, revokedByUserId, reason) {
  await knex.transaction(async (trx) => {
    await trx('refresh_tokens')
      .where({ session_id: sessionId })
      .whereNull('revoked_at')
      .forUpdate()
      .select('id');
    const session = await trx('auth_sessions').where({ id: sessionId }).forUpdate().first('id');
    if (!session) return;
    await trx('auth_sessions').where({ id: sessionId, status: 'active' }).update({
      status: 'revoked',
      revoked_at: trx.fn.now(),
      revoked_by_user_id: revokedByUserId,
      revoke_reason: reason,
      updated_at: trx.fn.now(),
    });
    await trx('refresh_tokens')
      .where({ session_id: sessionId })
      .whereNull('revoked_at')
      .update({ revoked_at: trx.fn.now() });
  });
}

export async function listShopAuthSessions(shopId, status = 'active', actorUserId = null) {
  const qb = knex('auth_sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where((scope) => {
      if (actorUserId) scope.where('u.id', actorUserId);
      scope.orWhereExists(function shopMember() {
        this.select(knex.raw('1'))
          .from('users_shops as us')
          .whereRaw('us.user_id = u.id')
          .andWhere('us.shop_id', shopId);
      });
    })
    .select(
      's.id',
      's.user_id',
      'u.name as user_name',
      'u.email as user_email',
      's.device_id',
      's.device_name',
      's.ip',
      's.login_at',
      's.last_used_at',
      's.expires_at',
      knex.raw(
        "CASE WHEN s.status = 'active' AND s.expires_at <= NOW() THEN 'expired' ELSE s.status END as status"
      ),
      's.revoked_at',
      's.revoke_reason'
    )
    .orderBy('s.last_used_at', 'desc');
  if (status === 'active') {
    qb.andWhere('s.status', 'active').andWhere('s.expires_at', '>', knex.fn.now());
  } else if (status !== 'all') {
    qb.andWhere('s.status', status);
  }
  return qb;
}

export async function getShopScopedAuthSession(shopId, sessionId, actorUserId = null) {
  return knex('auth_sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where('s.id', sessionId)
    .andWhere((scope) => {
      if (actorUserId) scope.where('u.id', actorUserId);
      scope.orWhereExists(function shopMember() {
        this.select(knex.raw('1'))
          .from('users_shops as us')
          .whereRaw('us.user_id = u.id')
          .andWhere('us.shop_id', shopId);
      });
    })
    .select('s.*')
    .first();
}

export async function revokeAllShopAuthSessions(shopId, revokedByUserId, reason) {
  const sessions = await listShopAuthSessions(shopId, 'active', revokedByUserId);
  for (const session of sessions) {
    await revokeAuthSession(session.id, revokedByUserId, reason);
  }
  return sessions.length;
}

function normalizeUsername(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

async function assertUsernameAvailable(username, excludeUserId = null) {
  if (!username) return;
  let qb = knex('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]);
  if (excludeUserId) qb = qb.whereNot('id', excludeUserId);
  const dup = await qb.first();
  if (dup) throw conflict('Username already in use');
}

export async function updateProfile({ userId, patch }) {
  const before = await knex('users').where({ id: userId }).first();
  if (!before) throw notFound('User not found');

  const update = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.phone !== undefined) {
    const phone = normalizeLoginPhone(patch.phone);
    if (!phone) throw badRequest('A valid 10-digit login phone is required');
    const duplicate = await knex('users')
      .where({ login_phone: phone })
      .whereNot('id', userId)
      .first('id');
    if (duplicate) throw conflict('Phone number already used for login');
    update.phone = phone;
    update.login_phone = phone;
  }
  if (patch.username !== undefined) {
    update.username = normalizeUsername(patch.username);
    await assertUsernameAvailable(update.username, userId);
  }
  if (!Object.keys(update).length) return sanitizeUser(before);

  update.updated_at = knex.fn.now();
  await knex('users').where({ id: userId }).update(update);
  const after = await knex('users').where({ id: userId }).first();
  return sanitizeUser(after);
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await knex('users').where({ id: userId }).first();
  if (!user) throw notFound('User not found');
  if (['super_admin', 'shop_admin'].includes(user.role)) {
    throw badRequest('Administrator passwords must be changed using email OTP');
  }
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw badRequest('Current password is incorrect');
  const hash = await hashPassword(newPassword);
  await knex('users').where({ id: userId }).update({
    password_hash: hash,
    must_change_password: false,
    password_changed_at: knex.fn.now(),
  });
  await revokeAllRefreshTokens(userId);
}

function otpDigest(challengeId, otp) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${challengeId}:${otp}`).digest('hex');
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

export async function requestAdminPasswordOtp(
  { requester, targetUserId, currentPassword, shopId },
  { sendEmail = sendPasswordOtpEmail } = {}
) {
  if (!shopId || !(await knex('shops').where({ id: shopId, is_active: true }).first('id'))) {
    throw badRequest('Select an active shop before requesting an email OTP');
  }
  if (
    requester.role !== 'super_admin' &&
    !(await knex('users_shops').where({ user_id: requester.id, shop_id: shopId }).first('user_id'))
  ) {
    throw forbidden('You do not have access to this shop');
  }
  const target = await knex('users').where({ id: targetUserId, is_active: true }).first();
  if (!target) throw notFound('User not found');
  if (!['super_admin', 'shop_admin'].includes(target.role)) {
    throw badRequest('Email OTP applies only to Super Admin and Shop Admin accounts');
  }
  if (!target.email) throw badRequest('Add an email address to this administrator first');
  if (
    target.role === 'shop_admin' &&
    !(await knex('users_shops').where({ user_id: target.id, shop_id: shopId }).first('user_id'))
  ) {
    throw forbidden('This administrator does not belong to the selected shop');
  }

  if (requester.id === target.id) {
    if (!currentPassword || !(await verifyPassword(currentPassword, target.password_hash))) {
      throw badRequest('Current password is incorrect');
    }
  } else if (requester.role !== 'super_admin' || target.role !== 'shop_admin') {
    throw forbidden('You cannot change this administrator password');
  }

  const recent = await knex('password_otp_challenges')
    .where({ target_user_id: target.id, requested_by_user_id: requester.id })
    .where('created_at', '>', new Date(Date.now() - 60_000))
    .first('id');
  if (recent) throw badRequest('Please wait one minute before requesting another OTP');

  const id = uuid();
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresInMinutes = 10;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);
  await knex('password_otp_challenges').insert({
    id,
    target_user_id: target.id,
    requested_by_user_id: requester.id,
    otp_hash: otpDigest(id, otp),
    expires_at: expiresAt,
  });
  try {
    await sendEmail({
      shopId,
      to: target.email,
      name: target.name,
      otp,
      expiresInMinutes,
    });
  } catch (error) {
    await knex('password_otp_challenges').where({ id }).del();
    throw error;
  }
  return { challenge_id: id, email: maskEmail(target.email), expires_at: expiresAt };
}

export async function confirmAdminPasswordOtp({ requester, challengeId, otp, newPassword }) {
  return confirmPasswordOtp(
    knex,
    { requester, challengeId, otp, newPassword },
    {
      digestOtp: otpDigest,
      hashPassword,
    }
  );
}

function parseExpiryDays(expiry) {
  if (typeof expiry !== 'string') return 30;
  const m = expiry.match(/^(\d+)([dhm])$/);
  if (!m) return 30;
  const n = Number(m[1]);
  if (m[2] === 'd') return n;
  if (m[2] === 'h') return Math.max(1, Math.ceil(n / 24));
  return Math.max(1, Math.ceil(n / 60 / 24));
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _ph, ...rest } = user;
  if (typeof rest.permissions === 'string') {
    try {
      rest.permissions = JSON.parse(rest.permissions);
      if (typeof rest.permissions === 'string') rest.permissions = JSON.parse(rest.permissions);
    } catch {
      rest.permissions = {};
    }
  }
  return rest;
}
