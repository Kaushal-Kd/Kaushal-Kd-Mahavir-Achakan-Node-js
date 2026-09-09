import {
  creditBalanceByPhonesQuerySchema,
  creditNoteListQuerySchema,
  settleCreditNoteBodySchema,
} from '@wrs/shared';

import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

import * as service from './service.js';

export default async function creditNoteRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const query = validate(creditNoteListQuerySchema, request.query || {});
    const result = await service.listCreditNotes(request.shopId, query);
    return {
      ok: true,
      data: result.data.map(service.formatListRow),
      meta: result.meta,
    };
  });

  fastify.get('/customer/:customerId/balance', async (request) => {
    const data = await service.getCustomerCreditBalance(request.shopId, request.params.customerId);
    return { ok: true, data };
  });

  fastify.get('/balance-by-phones', async (request) => {
    const query = validate(creditBalanceByPhonesQuerySchema, request.query || {});
    const data = await service.getCreditBalanceByPhones(request.shopId, query);
    return { ok: true, data };
  });

  fastify.post('/:id/settle', async (request) => {
    const body = validate(settleCreditNoteBodySchema, request.body || {});
    const before = await service.buildCreditNotesListQuery(request.shopId)
      .where('cn.id', request.params.id)
      .first();
    if (!before) throw notFound('Credit note not found');
    const row = await service.settleCreditNote(request.shopId, request.params.id, body);
    await request.audit('credit_notes', 'SETTLE', {
      id: request.params.id,
      old: before,
      new: row,
    });
    return { ok: true, data: service.formatListRow(row) };
  });
}
