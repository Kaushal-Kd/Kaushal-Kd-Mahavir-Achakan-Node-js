import {
  MODULES,
  ACTIONS,
  createCustomOrderFieldDefinitionSchema,
  updateCustomOrderFieldDefinitionSchema,
  reorderCustomOrderFieldDefinitionsSchema,
} from '@wrs/shared';

import { validate } from '../../utils/validate.js';
import {
  createCustomOrderFieldDefinition,
  deactivateCustomOrderFieldDefinition,
  listCustomOrderFieldDefinitions,
  reorderCustomOrderFieldDefinitions,
  updateCustomOrderFieldDefinition,
} from './service.js';

export default async function customOrderFieldRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get(
    '/',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.VIEW) },
    async (request) => {
      const includeInactive = request.query?.include_inactive === 'true';
      const data = await listCustomOrderFieldDefinitions(request.shopId, { includeInactive });
      return { ok: true, data };
    }
  );

  fastify.post(
    '/',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.CREATE) },
    async (request) => {
      const body = validate(createCustomOrderFieldDefinitionSchema, request.body || {});
      const data = await createCustomOrderFieldDefinition(request.shopId, body);
      await request.audit('custom_order_fields', 'CREATE', { id: data.id, new: data });
      return { ok: true, data };
    }
  );

  fastify.put(
    '/:id',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT) },
    async (request) => {
      const body = validate(updateCustomOrderFieldDefinitionSchema, {
        ...request.body,
        id: request.params.id,
      });
      const data = await updateCustomOrderFieldDefinition(request.shopId, request.params.id, body);
      await request.audit('custom_order_fields', 'UPDATE', { id: data.id, new: data });
      return { ok: true, data };
    }
  );

  fastify.delete(
    '/:id',
    {
      preHandler: [
        fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT),
        fastify.requireShopAdminPassword,
      ],
    },
    async (request) => {
      const data = await deactivateCustomOrderFieldDefinition(request.shopId, request.params.id);
      await request.audit('custom_order_fields', 'UPDATE', {
        id: data.id,
        new: { is_active: false },
      });
      return { ok: true, data };
    }
  );

  fastify.post(
    '/reorder',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT) },
    async (request) => {
      const body = validate(reorderCustomOrderFieldDefinitionsSchema, request.body || {});
      const data = await reorderCustomOrderFieldDefinitions(request.shopId, body.ordered_ids);
      await request.audit('custom_order_fields', 'UPDATE', { scope: 'reorder', count: data.length });
      return { ok: true, data };
    }
  );
}
