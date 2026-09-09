import { ACTIONS, MODULES } from '@wrs/shared';

import { validate } from '../../utils/validate.js';
import { listSystemLogsQuerySchema } from './schema.js';
import { getSystemLogById, listSystemLogs } from './service.js';

export default async function systemLogRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);
  fastify.addHook('onRequest', fastify.requirePermission(MODULES.AUDIT_LOGS, ACTIONS.VIEW));

  fastify.get('/', async (request) => {
    const query = validate(listSystemLogsQuerySchema, request.query || {});
    const result = await listSystemLogs(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const data = await getSystemLogById(request.shopId, request.params.id);
    return { ok: true, data };
  });
}
