import { ALL_ROLES, defaultPermissionsByRole, ROLES } from '@wrs/shared';

import knex from '../../db/knex.js';
import { invalidateAuthCacheForUser } from '../../lib/authCache.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';

import {
  getEffectivePermissionsByRole,
  normalizeMatrix,
  parseStoredPermissions,
  syncUserPermissionsForRole,
} from './service.js';

export { getEffectivePermissionsByRole, getPermissionsForRole } from './service.js';

export default async function roleRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/permissions', async (request) => {
    const data = await getEffectivePermissionsByRole(request.shopId);
    return {
      ok: true,
      data,
      meta: {
        roles: ALL_ROLES,
      },
    };
  });

  fastify.put('/permissions/:role', async (request) => {
    if (!['super_admin', 'shop_admin'].includes(request.authUser.role)) {
      throw forbidden('Only shop administrators can edit role permissions');
    }
    const role = request.params.role;
    if (!ALL_ROLES.includes(role)) throw notFound('Unknown role');
    if ([ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(role)) {
      throw badRequest('Administrator permissions cannot be modified');
    }
    const incoming = request.body?.permissions;
    if (!incoming || typeof incoming !== 'object') {
      throw badRequest('permissions payload is required');
    }
    const cleaned = normalizeMatrix(incoming);
    const existing = await knex('shop_role_permissions')
      .where({ shop_id: request.shopId, role })
      .first();
    if (existing) {
      await knex('shop_role_permissions')
        .where({ shop_id: request.shopId, role })
        .update({
          permissions: JSON.stringify(cleaned),
          updated_by_user_id: request.authUser.id,
          updated_at: knex.fn.now(),
        });
    } else {
      await knex('shop_role_permissions').insert({
        shop_id: request.shopId,
        role,
        permissions: JSON.stringify(cleaned),
        updated_by_user_id: request.authUser.id,
      });
    }
    const userIds = await syncUserPermissionsForRole(role, cleaned, request.shopId);
    for (const id of userIds) invalidateAuthCacheForUser(id);

    await request.audit('role_permissions', existing ? 'UPDATE' : 'CREATE', {
      id: `${request.shopId}:${role}`,
      new: cleaned,
      old: existing ? parseStoredPermissions(existing.permissions) : null,
    });
    return { ok: true, data: { role, permissions: cleaned } };
  });

  fastify.post('/permissions/:role/reset', async (request) => {
    if (!['super_admin', 'shop_admin'].includes(request.authUser.role)) {
      throw forbidden('Only shop administrators can reset role permissions');
    }
    const role = request.params.role;
    if (!ALL_ROLES.includes(role)) throw notFound('Unknown role');
    if ([ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(role)) {
      throw badRequest('Administrator permissions cannot be modified');
    }
    const existing = await knex('shop_role_permissions')
      .where({ shop_id: request.shopId, role })
      .first();
    const defaults = defaultPermissionsByRole();
    const cleaned = normalizeMatrix(defaults[role] || {});
    await knex('shop_role_permissions')
      .insert({
        shop_id: request.shopId,
        role,
        permissions: JSON.stringify(cleaned),
        updated_by_user_id: request.authUser.id,
      })
      .onConflict(['shop_id', 'role'])
      .merge({
        permissions: JSON.stringify(cleaned),
        updated_by_user_id: request.authUser.id,
        updated_at: knex.fn.now(),
      });
    await request.audit('role_permissions', existing ? 'UPDATE' : 'CREATE', {
      id: `${request.shopId}:${role}`,
      old: parseStoredPermissions(existing?.permissions),
      new: cleaned,
    });
    const userIds = await syncUserPermissionsForRole(role, cleaned, request.shopId);
    for (const id of userIds) invalidateAuthCacheForUser(id);

    return {
      ok: true,
      data: {
        role,
        permissions: cleaned,
      },
    };
  });
}
