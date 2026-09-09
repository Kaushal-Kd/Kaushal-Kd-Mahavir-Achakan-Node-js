import { createExpenseEntryBodySchema, updateExpenseEntryBodySchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';

import * as service from './service.js';

export default async function expenseEntryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await service.listExpenseEntries(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.post('/', async (request) => {
    const body = validate(createExpenseEntryBodySchema, request.body || {});
    const row = await service.createExpenseEntry(request.shopId, request.authUser?.id, body);
    await request.audit('expense_entries', 'CREATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'expense', 'CREATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateExpenseEntryBodySchema, request.body || {});
    const before = await service.getExpenseEntryRow(request.shopId, request.params.id);
    if (!before) throw notFound('Expense entry not found');
    const row = await service.updateExpenseEntry(request.shopId, request.params.id, body);
    await request.audit('expense_entries', 'UPDATE', { id: row.id, old: before, new: row });
    await logEntityRow(knex, request.shopId, row, 'expense', 'UPDATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await service.deleteExpenseEntry(request.shopId, request.params.id);
    await request.audit('expense_entries', 'DELETE', { id: old.id, old });
    await logEntityRow(knex, request.shopId, old, 'expense', 'DELETE', request.authUser);
    return { ok: true };
  });
}
