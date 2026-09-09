import {
  createPaymentSchema,
  securityDueQuerySchema,
  securityTransactionsQuerySchema,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { validate } from '../../utils/validate.js';

import { assertLedgerRefs } from './ledgerRefs.js';
import { insertOrderPayment } from './orderStatusAtPayment.js';
import { recomputeOrderPayment } from './recomputeOrderPayment.js';
import { listSecurityDue } from './securityDueService.js';
import { listSecurityTransactions } from './securityTransactionsService.js';
import { getOrdinarySecurityHeld } from '../security-charges/ledgerService.js';
import { excludeDirectConditionPayments } from '../security-charges/ledgerPredicates.js';

export default async function paymentRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/security-transactions', async (request) => {
    const query = validate(securityTransactionsQuerySchema, request.query || {});
    const result = await listSecurityTransactions(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/security-due', async (request) => {
    const query = validate(securityDueQuerySchema, request.query || {});
    const result = await listSecurityDue(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/', async (request) => {
    const qb = knex('payments').where({ shop_id: request.shopId, is_deleted: false });
    if (request.query.order_id) qb.andWhere({ order_id: request.query.order_id });
    if (request.query.from) qb.andWhere('payment_date', '>=', request.query.from);
    if (request.query.to) qb.andWhere('payment_date', '<=', request.query.to);
    const result = await paginate(qb, {
      page: request.query.page,
      per_page: request.query.per_page,
      sort: request.query.sort || '-payment_date',
    });
    return { ok: true, ...result };
  });

  fastify.post('/', async (request) => {
    const body = validate(createPaymentSchema, { ...request.body, shop_id: request.shopId });
    const id = uuid();
    await knex.transaction(
      async (trx) => {
        let order = null;
        if (body.order_id) {
          order = await trx('orders')
            .where({ id: body.order_id, shop_id: request.shopId, is_deleted: false })
            .forUpdate()
            .first();
          if (!order) throw notFound('Order not found');
          if (body.customer_id && body.customer_id !== order.customer_id)
            throw badRequest('Payment customer must match the booking');
        }
        if (['deposit', 'deposit_refund'].includes(body.category)) {
          if (!order) throw badRequest('Security payments must be linked to an active booking');
          if (body.category === 'deposit_refund') {
            const available = await getOrdinarySecurityHeld(trx, request.shopId, order.id);
            if (body.amount > available + 0.009)
              throw badRequest(
                'Refund exceeds available booking security; use Manage funds for condition-held deposits'
              );
          } else {
            const paid = await excludeDirectConditionPayments(
              trx('payments').where({
                shop_id: request.shopId,
                order_id: order.id,
                is_deleted: false,
              })
            )
              .whereIn('category', ['deposit', 'deposit_refund'])
              .select(
                trx.raw(
                  "COALESCE(SUM(CASE WHEN category = 'deposit' THEN amount ELSE -amount END),0) as held"
                )
              )
              .first();
            const pending = Math.max(
              0,
              Number(order.deposit_amount || 0) - Number(paid?.held || 0)
            );
            if (Number(order.deposit_amount || 0) <= 0 || body.amount > pending + 0.009)
              throw badRequest(
                'Set a sufficient Security Amount in Booking Edit before collecting security'
              );
          }
        }
        await assertLedgerRefs(trx, request.shopId, body);
        await insertOrderPayment(trx, request.shopId, {
          ...body,
          id,
          received_by: body.received_by || request.authUser.id,
        });
        if (body.order_id) {
          await recomputeOrderPayment(trx, request.shopId, body.order_id);
        }
      },
      { isolationLevel: 'read committed' }
    );
    const row = await knex('payments').where({ id }).first();
    await request.audit('payments', 'CREATE', { id, new: row });
    return { ok: true, data: row };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const row = await knex('payments')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Payment not found');
    await knex.transaction(
      async (trx) => {
        if (row.order_id)
          await trx('orders')
            .where({ id: row.order_id, shop_id: request.shopId })
            .forUpdate()
            .first('id');
        const operation = await trx('security_charge_operations')
          .where({ shop_id: request.shopId })
          .where((q) => q.where('payment_id', row.id).orWhere('source_deposit_payment_id', row.id))
          .first('id');
        if (operation)
          throw badRequest(
            'This payment is linked to condition funds and cannot be deleted; use Manage funds'
          );
        await trx('payments')
          .where({ id: row.id })
          .update({ is_deleted: true, deleted_at: trx.fn.now() });
        if (row.order_id) await recomputeOrderPayment(trx, request.shopId, row.order_id);
      },
      { isolationLevel: 'read committed' }
    );
    await request.audit('payments', 'DELETE', { id: row.id, old: row });
    return { ok: true };
  });
}
