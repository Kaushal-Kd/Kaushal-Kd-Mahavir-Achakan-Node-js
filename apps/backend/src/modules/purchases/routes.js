import { createPurchaseBodySchema, recordPurchasePaymentBodySchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';
import * as service from './service.js';

export default async function purchaseRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await service.listPurchases(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const row = await service.getPurchaseById(request.shopId, request.params.id);
    if (!row) throw notFound('Purchase not found');
    return { ok: true, data: row };
  });

  fastify.post('/', async (request) => {
    const body = validate(createPurchaseBodySchema, request.body || {});
    const row = await service.createPurchase(request.shopId, body, request.authUser?.id);
    await request.audit('purchases', 'CREATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'purchase', 'CREATE', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(createPurchaseBodySchema, request.body || {});
    const row = await service.updatePurchase(
      request.shopId,
      request.params.id,
      body,
      request.authUser?.id
    );
    await request.audit('purchases', 'UPDATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'purchase', 'UPDATE', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.post('/:id/payments', async (request) => {
    const body = validate(recordPurchasePaymentBodySchema, request.body || {});
    const row = await service.recordPurchasePayment(
      request.shopId,
      request.params.id,
      body,
      request.authUser?.id
    );
    await request.audit('purchases', 'PAYMENT', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'purchase', 'PAYMENT', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.post('/:id/cancel', async (request) => {
    const row = await service.cancelPurchase(
      request.shopId,
      request.params.id,
      request.authUser?.id
    );
    await request.audit('purchases', 'CANCEL', { id: row.id });
    await logEntityRow(knex, request.shopId, row, 'purchase', 'CANCEL', request.authUser, {
      billNo: row.bill_no,
    });
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await service.deletePurchase(request.shopId, request.params.id);
    await request.audit('purchases', 'DELETE', { id: old.id, old });
    await logEntityRow(knex, request.shopId, old, 'purchase', 'DELETE', request.authUser, {
      billNo: old.bill_no,
    });
    return { ok: true };
  });
}
