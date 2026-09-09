import { createIncomeEntryBodySchema, updateIncomeEntryBodySchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';

import * as service from './service.js';

export default async function incomeEntryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await service.listIncomeEntries(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.post('/', async (request) => {
    const body = validate(createIncomeEntryBodySchema, request.body || {});
    const row = await service.createIncomeEntry(request.shopId, request.authUser?.id, body);
    await request.audit('income_entries', 'CREATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'income', 'CREATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateIncomeEntryBodySchema, request.body || {});
    const before = await service.getIncomeEntryRow(request.shopId, request.params.id);
    if (!before) throw notFound('Income entry not found');
    const row = await service.updateIncomeEntry(request.shopId, request.params.id, body);
    await request.audit('income_entries', 'UPDATE', { id: row.id, old: before, new: row });
    await logEntityRow(knex, request.shopId, row, 'income', 'UPDATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await service.deleteIncomeEntry(request.shopId, request.params.id);
    await request.audit('income_entries', 'DELETE', { id: old.id, old });
    await logEntityRow(knex, request.shopId, old, 'income', 'DELETE', request.authUser);
    return { ok: true };
  });
}
