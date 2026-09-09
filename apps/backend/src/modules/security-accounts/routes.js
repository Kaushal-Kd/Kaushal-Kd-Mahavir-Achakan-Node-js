import { createSecurityAccountSchema, updateSecurityAccountSchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';

import * as service from './service.js';

export default async function securityAccountRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const rows = await service.list(request.shopId);
    return { ok: true, data: rows };
  });

  fastify.post('/', async (request) => {
    const body = validate(createSecurityAccountSchema, request.body || {});
    const row = await service.create(request.shopId, body);
    await request.audit('security_accounts', 'CREATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'account', 'CREATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateSecurityAccountSchema, request.body || {});
    const row = await service.update(request.shopId, request.params.id, body);
    await request.audit('security_accounts', 'UPDATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'account', 'UPDATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const before = await knex('security_accounts')
      .where({ shop_id: request.shopId, id: request.params.id })
      .first();
    await service.remove(request.shopId, request.params.id);
    await request.audit('security_accounts', 'DELETE', { id: request.params.id });
    if (before) {
      await logEntityRow(knex, request.shopId, before, 'account', 'DELETE', request.authUser);
    }
    return { ok: true };
  });
}
