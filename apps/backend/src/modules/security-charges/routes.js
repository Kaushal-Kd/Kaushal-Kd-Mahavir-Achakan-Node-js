import {
  createSecurityChargeBodySchema,
  securityChargeListQuerySchema,
  settleSecurityChargeBodySchema,
  syncReturnSettlementChargeBodySchema,
  securityChargeOperationBodySchema,
} from '@wrs/shared';

import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

import * as service from './service.js';
import { executeConditionChargeOperation, summarizeConditionChargeWithTrx } from './ledgerService.js';
import knex from '../../db/knex.js';

export default async function securityChargeRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const query = validate(securityChargeListQuerySchema, request.query || {});
    const result = await service.listSecurityCharges(request.shopId, query);
    return {
      ok: true,
      data: result.data.map(service.formatListRow),
      meta: result.meta,
      summary: result.summary,
    };
  });

  fastify.get('/order/:orderId/pending-total', async (request) => {
    const total = await service.getPendingChargesTotalForOrder(
      request.shopId,
      request.params.orderId
    );
    return { ok: true, data: { total } };
  });

  fastify.get('/:id/operations', async (request) => ({ ok: true,
    data: await summarizeConditionChargeWithTrx(knex, request.shopId, request.params.id) }));

  fastify.post('/:id/operations', async (request) => {
    const body = validate(securityChargeOperationBodySchema, request.body || {});
    const result = await executeConditionChargeOperation(request.shopId, request.authUser.id, request.params.id, body);
    if (!result.replayed) await request.audit('security_charges', body.kind.toUpperCase(), { id: request.params.id, new: result });
    return { ok: true, data: result.charge, operations: result.operations, replayed: !!result.replayed };
  });

  fastify.post('/', async (request) => {
    const body = validate(createSecurityChargeBodySchema, request.body || {});
    const row = await service.createSecurityCharge(request.shopId, request.authUser?.id, body);
    await request.audit('security_charges', 'CREATE', { id: row.id, new: row });
    return { ok: true, data: row };
  });

  fastify.post('/sync-return-settlement', async (request) => {
    const body = validate(syncReturnSettlementChargeBodySchema, request.body || {});
    const data = await service.syncReturnSettlementCharge(
      request.shopId,
      request.authUser?.id,
      body
    );
    await request.audit('security_charges', 'SYNC_RETURN_SETTLEMENT', {
      order_id: body.order_id,
      new: data,
    });
    return { ok: true, data };
  });

  fastify.post('/:id/settle', async (request) => {
    const body = validate(settleSecurityChargeBodySchema, request.body || {});
    const before = await service.buildSecurityChargesListQuery(request.shopId)
      .where('sc.id', request.params.id)
      .first();
    if (!before) throw notFound('Security charge not found');
    const row = await service.settleSecurityCharge(
      request.shopId,
      request.authUser?.id,
      request.params.id,
      body
    );
    await request.audit('security_charges', 'SETTLE', {
      id: request.params.id,
      old: before,
      new: row,
    });
    return { ok: true, data: row };
  });
}
