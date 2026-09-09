import {
  ACTIONS,
  MODULES,
  authSessionListQuerySchema,
  changePasswordSchema,
  confirmPasswordOtpSchema,
  loginSchema,
  requestPasswordOtpSchema,
  revokeAuthSessionSchema,
  shopAdminPasswordBodySchema,
  updateProfileSchema,
} from '@wrs/shared';

import { hasCachedShopAccess, invalidateAuthCacheForUser } from '../../lib/authCache.js';
import { z } from 'zod';
import { assertShopIpAccess, resolveShopIpAccess } from '../ip-whitelist/shopService.js';
import knex from '../../db/knex.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { verifyShopAdminPassword } from '../../utils/shopAdmin.js';
import { assertIpAccess } from '../ip-whitelist/service.js';

import {
  login,
  createAuthSession,
  createRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
  changePassword,
  getUserShops,
  sanitizeUser,
  updateProfile,
  getShopScopedAuthSession,
  listShopAuthSessions,
  revokeAuthSession,
  revokeAllShopAuthSessions,
  requestAdminPasswordOtp,
  confirmAdminPasswordOtp,
} from './service.js';

export default async function authRoutes(fastify) {
  fastify.post('/login', async (request, reply) => {
    const body = validate(loginSchema, request.body || {});
    const { user, shops } = await login({
      identity: body.identity,
      password: body.password,
      device_id: body.device_id,
      device_name: body.device_name,
      ip: request.ip,
    });
    const ipAccess = await assertIpAccess(user.id, request.ip);
    const shopAccess = await Promise.all(
      shops.map((shop) => resolveShopIpAccess(knex, shop.id, user.id, request.ip))
    );
    ipAccess.restricted ||= shopAccess.some((access) => access.restricted);
    const sessionId = await createAuthSession({
      userId: user.id,
      deviceId: body.device_id,
      deviceName: body.device_name,
      ip: request.ip,
    });
    const accessToken = await reply.jwtSign({
      sub: user.id,
      role: user.role,
      email: user.email,
      sid: sessionId,
    });
    const refreshToken = await createRefreshToken({
      userId: user.id,
      deviceId: body.device_id,
      deviceName: body.device_name,
      ip: request.ip,
      sessionId,
    });
    return {
      ok: true,
      data: {
        user: sanitizeUser(user),
        shops,
        access_token: accessToken,
        refresh_token: refreshToken,
        ip_access_restricted: ipAccess.restricted,
      },
    };
  });

  // Refresh access tokens without requiring a valid access token in the header.
  fastify.post('/refresh', async (request, reply) => {
    const { refresh_token, device_id, device_name } = request.body || {};
    if (!refresh_token) {
      return reply
        .status(400)
        .send({ ok: false, error: { code: 'BAD_REQUEST', message: 'refresh_token required' } });
    }

    // Try to read user id from the (possibly expired) access token in the
    // Authorization header. Safe against missing or malformed tokens — we
    // fall back to looking up the user via the refresh token hash.
    let userIdHint = null;
    try {
      const raw = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (raw) {
        const decoded = fastify.jwt.decode(raw);
        userIdHint = decoded?.sub || decoded?.payload?.sub || null;
      }
    } catch {
      userIdHint = null;
    }

    try {
      const {
        token: newRefresh,
        userId,
        sessionId,
        ipAccess,
      } = await rotateRefreshToken({
        userId: userIdHint,
        oldToken: refresh_token,
        deviceId: device_id,
        deviceName: device_name,
        ip: request.ip,
      });
      const user = await knex('users').where({ id: userId, is_active: true }).first();
      if (!user) {
        return reply
          .status(401)
          .send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'User no longer active' } });
      }
      const access = await reply.jwtSign({
        sub: user.id,
        role: user.role,
        email: user.email,
        sid: sessionId,
      });
      return {
        ok: true,
        data: {
          access_token: access,
          refresh_token: newRefresh,
          ip_access_restricted: ipAccess.restricted,
        },
      };
    } catch (err) {
      if (err?.code === 'IP_ACCESS_DENIED') throw err;
      return reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: err?.message || 'Session expired' },
      });
    }
  });

  fastify.post('/logout', { onRequest: [fastify.authenticate] }, async (request) => {
    if (request.user?.sid) {
      await revokeAuthSession(request.user.sid, request.authUser.id, 'User logged out');
    } else {
      await revokeAllRefreshTokens(request.authUser.id);
    }
    return { ok: true };
  });

  fastify.get(
    '/devices',
    {
      onRequest: [
        fastify.authenticate,
        fastify.requireShop,
        fastify.requirePermission(MODULES.SETTINGS, ACTIONS.VIEW),
      ],
    },
    async (request) => {
      const query = validate(authSessionListQuerySchema, request.query || {});
      const rows = await listShopAuthSessions(request.shopId, query.status, request.authUser.id);
      return { ok: true, data: { rows, current_session_id: request.user?.sid || null } };
    }
  );

  fastify.post(
    '/devices/:id/revoke',
    {
      onRequest: [
        fastify.authenticate,
        fastify.requireShop,
        fastify.requirePermission(MODULES.SETTINGS, ACTIONS.EDIT),
      ],
    },
    async (request) => {
      const body = validate(revokeAuthSessionSchema, request.body || {});
      const session = await getShopScopedAuthSession(
        request.shopId,
        request.params.id,
        request.authUser.id
      );
      if (!session) throw notFound('Device session not found');
      await revokeAuthSession(session.id, request.authUser.id, body.reason);
      await request.audit('auth_session', 'UPDATE', { id: session.id, new: { status: 'revoked' } });
      return { ok: true };
    }
  );

  fastify.post(
    '/devices/revoke-all',
    {
      onRequest: [
        fastify.authenticate,
        fastify.requireShop,
        fastify.requirePermission(MODULES.SETTINGS, ACTIONS.EDIT),
      ],
    },
    async (request) => {
      const body = validate(revokeAuthSessionSchema, request.body || {});
      const count = await revokeAllShopAuthSessions(
        request.shopId,
        request.authUser.id,
        body.reason
      );
      await request.audit('auth_session', 'UPDATE', { id: 'all', new: { count } });
      return { ok: true, data: { count } };
    }
  );

  fastify.get('/me', { onRequest: [fastify.authenticate] }, async (request) => {
    const shops = await getUserShops(request.authUser.id, request.authUser.role);
    return {
      ok: true,
      data: {
        user: sanitizeUser(request.authUser),
        shops,
        ip_access_restricted: Boolean(request.ipAccess?.restricted),
      },
    };
  });

  // Presence heartbeat. The handler does nothing on purpose: the global
  // preHandler in plugins/auth.js already stamps `users.last_seen_at` for any
  // authenticated request, throttled to one write per user per minute. Its only
  // job is to be a request cheap enough for the desktop client to make on a
  // timer, so "online" can mean "the app is open" rather than "somebody clicked
  // something in the last two minutes".
  fastify.get('/ping', { onRequest: [fastify.authenticate] }, async (request) => ({
    ok: true,
    data: { ip_access_restricted: Boolean(request.ipAccess?.restricted) },
  }));

  fastify.patch('/profile', { onRequest: [fastify.authenticate] }, async (request) => {
    const body = validate(updateProfileSchema, request.body || {});
    const user = await updateProfile({
      userId: request.authUser.id,
      patch: body,
    });
    invalidateAuthCacheForUser(request.authUser.id);
    return { ok: true, data: { user } };
  });

  fastify.post(
    '/password-otp/request',
    { onRequest: [fastify.authenticate, fastify.requireShop] },
    async (request) => {
      const body = validate(requestPasswordOtpSchema, request.body || {});
      const result = await requestAdminPasswordOtp({
        shopId: request.shopId,
        requester: request.authUser,
        targetUserId: body.target_user_id,
        currentPassword: body.current_password,
      });
      await request.audit('password_otp', 'CREATE', {
        id: result.challenge_id,
        new: { target_user_id: body.target_user_id, expires_at: result.expires_at },
      });
      return { ok: true, data: result };
    }
  );

  fastify.post('/password-otp/confirm', { onRequest: [fastify.authenticate] }, async (request) => {
    const body = validate(confirmPasswordOtpSchema, request.body || {});
    const result = await confirmAdminPasswordOtp({
      requester: request.authUser,
      challengeId: body.challenge_id,
      otp: body.otp,
      newPassword: body.new_password,
    });
    invalidateAuthCacheForUser(result.target_user_id);
    await request.audit('password_otp', 'UPDATE', {
      id: body.challenge_id,
      new: { target_user_id: result.target_user_id, status: 'consumed' },
    });
    return { ok: true, data: result };
  });

  fastify.post('/change-password', { onRequest: [fastify.authenticate] }, async (request) => {
    const body = validate(changePasswordSchema, request.body || {});
    await changePassword({
      userId: request.authUser.id,
      currentPassword: body.current_password,
      newPassword: body.new_password,
    });
    return { ok: true };
  });

  fastify.post('/select-shop', { onRequest: [fastify.authenticate] }, async (request) => {
    const { shop_id } = validate(
      z.object({ shop_id: z.string().uuid() }).strict(),
      request.body || {}
    );
    if (!(await hasCachedShopAccess(knex, request.authUser.id, shop_id, request.authUser.role)))
      throw forbidden('You do not have access to this shop');
    const access = await assertShopIpAccess(knex, shop_id, request.authUser.id, request.ip);
    await knex('users')
      .where({ id: request.authUser.id })
      .update({ last_selected_shop_id: shop_id });
    return { ok: true, data: { ip_access_restricted: access.restricted } };
  });

  fastify.post(
    '/verify-shop-admin-password',
    { onRequest: [fastify.authenticate, fastify.requireShop] },
    async (request) => {
      const body = validate(shopAdminPasswordBodySchema, request.body || {});
      await verifyShopAdminPassword(request.shopId, body.admin_password);
      return { ok: true };
    }
  );
}
