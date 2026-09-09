import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { hasPermission, shopAdminPasswordBodySchema } from '@wrs/shared';

import { env } from '../config/env.js';
import { enforceApiPermission } from '../lib/apiPermissionMap.js';
import {
  hasCachedShopAccess,
  hydrateShopPermissions,
  loadCachedAuthUser,
} from '../lib/authCache.js';
import { touchUserPresence } from '../lib/presence.js';
import knex from '../db/knex.js';
import { assertIpAccess } from '../modules/ip-whitelist/service.js';
import { assertShopIpAccess } from '../modules/ip-whitelist/shopService.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { validate } from '../utils/validate.js';
import { verifyShopAdminPassword } from '../utils/shopAdmin.js';

const sessionTouchAt = new Map();

async function authPlugin(fastify) {
  fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRY },
  });

  fastify.decorateRequest('ipAccess', null);

  fastify.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const { sub } = request.user;
    const sessionId = request.user?.sid;
    if (sessionId) {
      const session = await knex('auth_sessions')
        .where({ id: sessionId, user_id: sub, status: 'active' })
        .whereNull('revoked_at')
        .where('expires_at', '>', knex.fn.now())
        .first('id');
      if (!session) throw unauthorized('Device session revoked or expired');
      const now = Date.now();
      if (now - (sessionTouchAt.get(sessionId) || 0) > 60_000) {
        sessionTouchAt.set(sessionId, now);
        knex('auth_sessions')
          .where({ id: sessionId })
          .update({ last_used_at: knex.fn.now(), updated_at: knex.fn.now() })
          .catch(() => {});
      }
    }
    const cachedUser = await loadCachedAuthUser(knex, sub);
    if (!cachedUser) throw unauthorized('User not found or inactive');
    // Permission hydration is request/shop-specific; never mutate the shared
    // cached object or concurrent requests for two shops could leak scopes.
    const user = { ...cachedUser, permissions: cachedUser.permissions };
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw unauthorized('Account is temporarily locked');
    }
    request.authUser = user;
    request.ipAccess = await assertIpAccess(user.id, request.ip);
    const headerShopId = String(request.headers['x-shop-id'] || '').trim();
    if (headerShopId) {
      const allowed = await hasCachedShopAccess(knex, user.id, headerShopId, user.role);
      if (!allowed) throw forbidden('You do not have access to this shop');
      await hydrateShopPermissions(knex, user, headerShopId);
      request.shopId = headerShopId;
      request.ipAccess = await assertShopIpAccess(knex, headerShopId, user.id, request.ip);
    }
  });

  fastify.decorate('requireShop', async (request) => {
    const shopId =
      request.headers['x-shop-id'] ||
      request.query?.shop_id ||
      request.body?.shop_id ||
      request.authUser?.last_selected_shop_id;
    if (!shopId) throw forbidden('Shop context is required');
    const allowed = await hasCachedShopAccess(
      knex,
      request.authUser.id,
      shopId,
      request.authUser.role
    );
    if (!allowed) throw forbidden('You do not have access to this shop');
    await hydrateShopPermissions(knex, request.authUser, shopId);
    request.shopId = shopId;
    request.ipAccess = await assertShopIpAccess(knex, shopId, request.authUser.id, request.ip);
  });

  fastify.decorate('requirePermission', (moduleName, action) => async (request) => {
    if (!request.authUser) throw unauthorized();
    const ok = hasPermission(request.authUser, moduleName, action);
    if (!ok) throw forbidden(`Missing permission: ${moduleName}.${action}`);
  });

  fastify.decorate('requireShopAdminPassword', async (request) => {
    const shopId =
      request.shopId || request.headers['x-shop-id'] || request.authUser?.last_selected_shop_id;
    const body = validate(shopAdminPasswordBodySchema, request.body || {});
    await verifyShopAdminPassword(shopId, body.admin_password);
  });

  fastify.addHook('preHandler', async (request) => {
    enforceApiPermission(request);
    // Throttled internally to ~1 write per user per minute, and never awaited
    // so it cannot slow down or fail the request.
    if (request.authUser?.id) touchUserPresence(knex, request.authUser.id);
  });
}

export default fp(authPlugin, { name: 'auth' });
