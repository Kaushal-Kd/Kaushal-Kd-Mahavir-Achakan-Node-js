import { globalIpWhitelistSchema, userIpWhitelistSchema } from '@wrs/shared';

import { forbidden } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { z } from 'zod';
import { applyShopIpCommand, getShopIpPolicies } from './shopService.js';

import { getAdminIpWhitelist, updateGlobalIpWhitelist, updateUserIpWhitelist } from './service.js';

export async function requireSuperAdmin(request) {
  if (request.authUser?.role !== 'super_admin') {
    throw forbidden('Only super administrators can manage IP whitelisting');
  }
}

export default async function ipWhitelistRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/shop', { onRequest: [fastify.requireShop] }, async (r) => ({
    ok: true,
    data: await getShopIpPolicies(r.shopId, r.authUser.id, r.ip),
  }));
  fastify.post('/shop/:shopId/commands', { onRequest: [fastify.requireShop] }, async (r) => {
    if (validate(z.string().uuid(), r.params.shopId) !== r.shopId)
      throw forbidden('Shop context does not match the requested policy');
    const data = await applyShopIpCommand(r.shopId, r.authUser.id, r.ip, r.body);
    if (!data.replayed)
      await r.audit('ip_whitelist', 'UPDATE_SHOP', {
        id: r.shopId,
        new: { ...r.body.policy, revision: data.revision },
      });
    return { ok: true, data };
  });

  fastify.get('/', { onRequest: [requireSuperAdmin] }, async (request) => {
    const data = await getAdminIpWhitelist(request.ip);
    return { ok: true, data };
  });

  fastify.put('/global', { onRequest: [requireSuperAdmin] }, async (request) => {
    const body = validate(globalIpWhitelistSchema, request.body || {});
    const result = await updateGlobalIpWhitelist(body, request.authUser.id);
    await request.audit('ip_whitelist', 'UPDATE_GLOBAL', {
      id: 'global',
      old: result.before,
      new: result.after,
    });
    return { ok: true, data: result.after };
  });

  fastify.put('/users/:id', { onRequest: [requireSuperAdmin] }, async (request) => {
    const body = validate(userIpWhitelistSchema, request.body || {});
    const result = await updateUserIpWhitelist(request.params.id, body, request.authUser.id);
    await request.audit('ip_whitelist', 'UPDATE_USER', {
      id: request.params.id,
      old: result.before,
      new: result.after,
    });
    return { ok: true, data: result.after };
  });
}
