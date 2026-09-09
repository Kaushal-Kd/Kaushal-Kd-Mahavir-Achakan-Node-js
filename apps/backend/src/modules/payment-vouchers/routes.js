import { createPaymentVoucherBodySchema, updatePaymentVoucherBodySchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';

import * as service from './service.js';

export default async function paymentVoucherRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await service.listPaymentVouchers(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const result = await service.getPaymentVoucherRow(request.shopId, request.params.id);
    if (!result) throw notFound('Payment voucher not found');
    return { ok: true, data: result };
  });

  fastify.post('/', async (request) => {
    const body = validate(createPaymentVoucherBodySchema, request.body || {});
    const result = await service.createPaymentVoucher(request.shopId, request.authUser?.id, body);

    if (result?.rows) {
      for (const row of result.rows) {
        await request.audit('payment_vouchers', 'CREATE', { id: row.id, new: row });
        await logEntityRow(knex, request.shopId, row, 'payment_voucher', 'CREATE', request.authUser);
      }
      return { ok: true, data: result.rows, meta: { count: result.count } };
    }

    await request.audit('payment_vouchers', 'CREATE', { id: result.id, new: result });
    await logEntityRow(knex, request.shopId, result, 'payment_voucher', 'CREATE', request.authUser);
    return { ok: true, data: result };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updatePaymentVoucherBodySchema, request.body || {});
    const result = await service.updatePaymentVoucher(
      request.shopId,
      request.params.id,
      request.authUser?.id,
      body
    );
    await request.audit('payment_vouchers', 'UPDATE', { id: result.id, new: result });
    await logEntityRow(knex, request.shopId, result, 'payment_voucher', 'UPDATE', request.authUser);
    return { ok: true, data: result };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await service.deletePaymentVoucher(request.shopId, request.params.id);
    await request.audit('payment_vouchers', 'DELETE', { id: old.id, old });
    await logEntityRow(knex, request.shopId, old, 'payment_voucher', 'DELETE', request.authUser);
    return { ok: true };
  });
}
