import {
  ACTIONS,
  MODULES,
  createReceiptVoucherBodySchema,
  updateReceiptVoucherBodySchema,
} from '@wrs/shared';
import { z } from 'zod';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';

import {
  listReceiptVouchers,
  getReceiptVoucherRow,
  createReceiptVoucher,
  updateReceiptVoucher,
  deleteReceiptVoucher,
} from './service.js';

const receiptVoucherIdSchema = z.object({ id: z.string().uuid() });

export default async function receiptVoucherRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await listReceiptVouchers(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get(
    '/:id',
    { preHandler: fastify.requirePermission(MODULES.VOUCHERS, ACTIONS.VIEW) },
    async (request) => {
      const { id } = validate(receiptVoucherIdSchema, request.params);
      const row = await getReceiptVoucherRow(request.shopId, id);
      if (!row) throw notFound('Receipt voucher not found');
      return { ok: true, data: row };
    }
  );

  fastify.post('/', async (request) => {
    const body = validate(createReceiptVoucherBodySchema, request.body || {});
    const row = await createReceiptVoucher(request.shopId, request.authUser?.id, body);
    await request.audit('receipt_vouchers', 'CREATE', { id: row.id, new: row });
    await logEntityRow(knex, request.shopId, row, 'receipt_voucher', 'CREATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateReceiptVoucherBodySchema, request.body || {});
    const before = await getReceiptVoucherRow(request.shopId, request.params.id);
    if (!before) throw notFound('Receipt voucher not found');
    const row = await updateReceiptVoucher(request.shopId, request.params.id, body);
    await request.audit('receipt_vouchers', 'UPDATE', { id: row.id, old: before, new: row });
    await logEntityRow(knex, request.shopId, row, 'receipt_voucher', 'UPDATE', request.authUser);
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await deleteReceiptVoucher(request.shopId, request.params.id);
    await request.audit('receipt_vouchers', 'DELETE', { id: old.id, old });
    await logEntityRow(knex, request.shopId, old, 'receipt_voucher', 'DELETE', request.authUser);
    return { ok: true };
  });
}
