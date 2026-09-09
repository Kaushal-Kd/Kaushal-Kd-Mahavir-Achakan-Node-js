import { createJournalVoucherBodySchema, updateJournalVoucherBodySchema } from '@wrs/shared';

import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

import * as service from './service.js';

export default async function journalVoucherRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await service.listJournalVouchers(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.post('/', async (request) => {
    const body = validate(createJournalVoucherBodySchema, request.body || {});
    const row = await service.createJournalVoucher(request.shopId, request.authUser?.id, body);
    await request.audit('journal_vouchers', 'CREATE', { id: row.id, new: row });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateJournalVoucherBodySchema, request.body || {});
    const before = await service.getJournalVoucherRow(request.shopId, request.params.id);
    if (!before) throw notFound('Journal voucher not found');
    const row = await service.updateJournalVoucher(request.shopId, request.params.id, body);
    await request.audit('journal_vouchers', 'UPDATE', { id: row.id, old: before, new: row });
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const old = await service.deleteJournalVoucher(request.shopId, request.params.id);
    await request.audit('journal_vouchers', 'DELETE', { id: old.id, old });
    return { ok: true };
  });
}
