import { createSaleBodySchema, recordSalePaymentBodySchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';
import * as service from './service.js';

export default async function saleRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await service.listSales(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const row = await service.getSaleById(request.shopId, request.params.id);
    if (!row) throw notFound('Sale not found');
    return { ok: true, data: row };
  });

  fastify.post('/', async (request) => {
    const body = validate(createSaleBodySchema, request.body || {});
    const row = await service.createSale(request.shopId, body, request.authUser?.id);
    await request.audit('sales', 'CREATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'sale', 'CREATE', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(createSaleBodySchema, request.body || {});
    const row = await service.updateSale(request.shopId, request.params.id, body, request.authUser?.id);
    await request.audit('sales', 'UPDATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'sale', 'UPDATE', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.post('/:id/payments', async (request) => {
    const body = validate(recordSalePaymentBodySchema, request.body || {});
    const row = await service.recordSalePayment(
      request.shopId,
      request.params.id,
      body,
      request.authUser?.id
    );
    await request.audit('sales', 'PAYMENT', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'sale', 'PAYMENT', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.post('/:id/cancel', async (request) => {
    const row = await service.cancelSale(request.shopId, request.params.id, request.authUser?.id);
    await request.audit('sales', 'CANCEL', { id: row.id });
    await logEntityRow(knex, request.shopId, row, 'sale', 'CANCEL', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await service.deleteSale(request.shopId, request.params.id);
    await request.audit('sales', 'DELETE', { id: old.id, old });
    await logEntityRow(knex, request.shopId, old, 'sale', 'DELETE', request.authUser, {
      billNo: old.bill_no,
    });
    return { ok: true };
  });
}
