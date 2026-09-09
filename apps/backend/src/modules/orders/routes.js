import {
  ACTIONS,
  MODULES,
  cancelOrderBodySchema,
  createOrderInputSchema,
  updateOrderInputSchema,
  deleteOrderBodySchema,
  orderAdjustDiscountTotalBodySchema,
  orderSetStageBodySchema,
  orderSetStageBulkBodySchema,
  orderSetStageBatchBodySchema,
  orderDeliverySettlementBodySchema,
  orderReturnSettlementBodySchema,
  orderSetConditionBodySchema,
  orderListQuerySchema,
  itemsToCollectQuerySchema,
  itemsToPrepareQuerySchema,
  orderChecklistCombinedChargeBodySchema,
  orderChecklistCommandSchema,
  orderReassignSalesmanBodySchema,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { syncCombinedChecklistSecurityCharge } from '../security-charges/service.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { logBookingById, logBookingFromOrder } from '../system-logs/helpers.js';

import {
  listOrders,
  listBookedProducts,
  listItemsToCollect,
  listItemsToCollectLines,
  listItemsToPrepare,
  listItemsToPrepareLines,
  reassignOrderItemSalesman,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderSecurityStatus,
  updateOrderStatusFlag,
  bulkUpdateOrderStatusFlag,
  batchUpdateOrderStatusFlags,
  updateItemCondition,
  cancelOrder,
  adjustOrderDiscountTotal,
  deleteOrder,
  settleOrderDelivery,
  settleOrderReturn,
  applyChecklistCommand,
} from './service.js';
import { verifyShopAdminPassword } from '../../utils/shopAdmin.js';

function applyItemStageLinesDefaults(query) {
  if (!query.lines) return query;
  if (query.skip_enrich === true || query.skip_enrich === false) return query;
  return { ...query, skip_enrich: false };
}

/** Slim order payload for audit_logs (avoids serializing full line lists). */
function orderAuditSummary(order) {
  if (!order) return null;
  const itemCount = Array.isArray(order.items) ? order.items.length : 0;
  const accessoryCount = Array.isArray(order.accessories) ? order.accessories.length : 0;
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    customer_id: order.customer_id,
    pickup_date: order.pickup_date,
    return_date: order.return_date,
    total_amount: order.total_amount,
    paid_amount: order.paid_amount,
    balance: order.balance,
    item_count: itemCount + accessoryCount,
  };
}

function scheduleOrderSideEffects(request, tasks) {
  void Promise.all(tasks).catch((err) => {
    request.log.warn({ err }, 'Post-order side effects failed');
  });
}

export default async function orderRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/booked-products', async (request) => {
    const result = await listBookedProducts(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/items-to-collect', async (request) => {
    const query = applyItemStageLinesDefaults(validate(itemsToCollectQuerySchema, request.query));
    const result = query.lines
      ? await listItemsToCollectLines(request.shopId, query)
      : await listItemsToCollect(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/items-to-prepare', async (request) => {
    const query = applyItemStageLinesDefaults(validate(itemsToPrepareQuerySchema, request.query));
    const result = query.lines
      ? await listItemsToPrepareLines(request.shopId, query)
      : await listItemsToPrepare(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/', async (request) => {
    const query = validate(orderListQuerySchema, request.query);
    const result = await listOrders(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const data = await getOrder(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = validate(createOrderInputSchema, { ...request.body, shop_id: request.shopId });
    const data = await createOrder(request.shopId, body, request.authUser.id);
    scheduleOrderSideEffects(request, [
      request.audit('orders', 'CREATE', { id: data.id, new: orderAuditSummary(data) }),
      logBookingFromOrder(knex, request.shopId, data, 'CREATE', request.authUser),
    ]);
    return { ok: true, data };
  });

  fastify.post('/verify-admin-password', async (request) => {
    const body = validate(deleteOrderBodySchema, request.body || {});
    await verifyShopAdminPassword(request.shopId, body.admin_password);
    return { ok: true };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateOrderInputSchema, { ...request.body, shop_id: request.shopId });
    const data = await updateOrder(request.shopId, request.params.id, body, request.authUser.id);
    if (!data.command_replayed) scheduleOrderSideEffects(request, [
      request.audit('orders', 'UPDATE', { id: request.params.id, new: orderAuditSummary(data) }),
      logBookingFromOrder(knex, request.shopId, data, 'UPDATE', request.authUser),
    ]);
    return { ok: true, data };
  });

  fastify.post('/:id/stage', async (request) => {
    const body = validate(orderSetStageBodySchema, request.body || {});
    const data = await updateOrderStatusFlag(
      request.shopId,
      request.params.id,
      body.item_id,
      body.item_type || 'item',
      body.field,
      !!body.value,
      request.authUser.id,
      body
    );
    await request.audit('orders', 'UPDATE_STAGE', {
      id: request.params.id,
      new: { field: body.field, value: body.value },
    });
    await logBookingById(knex, request.shopId, request.params.id, 'UPDATE_STAGE', request.authUser);
    return { ok: true, data };
  });

  fastify.post('/:id/checklist-command', {
    preHandler: fastify.requirePermission(MODULES.BOOKING, ACTIONS.EDIT),
  }, async (request) => {
    const body = validate(orderChecklistCommandSchema, request.body || {});
    const result = await applyChecklistCommand(request.shopId, request.params.id, body, request.authUser.id);
    if (!result.replayed) scheduleOrderSideEffects(request, [
      request.audit('orders', 'CHECKLIST_COMMAND', { id: request.params.id,
        new: { stages: body.stage_updates.length, conditions: body.condition_updates.length } }),
      logBookingFromOrder(knex, request.shopId, result.order, 'CHECKLIST_COMMAND', request.authUser),
    ]);
    return { ok: true, data: result.order, replayed: result.replayed };
  });

  fastify.post('/:id/stage-bulk', async (request) => {
    const body = validate(orderSetStageBulkBodySchema, request.body || {});
    const data = await bulkUpdateOrderStatusFlag(
      request.shopId,
      request.params.id,
      body.field,
      !!body.value,
      request.authUser.id,
      body.expected_items || []
    );
    await request.audit('orders', 'UPDATE_STAGE_BULK', {
      id: request.params.id,
      new: { field: body.field, value: body.value },
    });
    await logBookingById(
      knex,
      request.shopId,
      request.params.id,
      'UPDATE_STAGE_BULK',
      request.authUser
    );
    return { ok: true, data };
  });

  fastify.post('/:id/stage-batch', async (request) => {
    const body = validate(orderSetStageBatchBodySchema, request.body || {});
    const data = await batchUpdateOrderStatusFlags(
      request.shopId,
      request.params.id,
      body.updates,
      request.authUser.id,
      { admin_password: body.admin_password }
    );
    await request.audit('orders', 'UPDATE_STAGE_BATCH', {
      id: request.params.id,
      new: { count: body.updates.length },
    });
    await logBookingById(
      knex,
      request.shopId,
      request.params.id,
      'UPDATE_STAGE_BATCH',
      request.authUser
    );
    return { ok: true, data };
  });

  fastify.post(
    '/:id/reassign-salesman',
    {
      preHandler: fastify.requirePermission(MODULES.BOOKING, ACTIONS.EDIT),
    },
    async (request) => {
      const body = validate(orderReassignSalesmanBodySchema, request.body || {});
      const data = await reassignOrderItemSalesman(request.shopId, request.params.id, body);
      if (data.changed) {
        await request.audit('orders', 'REASSIGN_SALESMAN', {
          id: request.params.id,
          old: { lines: data.previous },
          new: {
            order_item_ids: data.changed_order_item_ids,
            sales_person_id: data.sales_person_id,
            sales_person_name: data.sales_person_name,
          },
        });
        await logBookingById(
          knex,
          request.shopId,
          request.params.id,
          'REASSIGN_SALESMAN',
          request.authUser
        );
      }
      return { ok: true, data };
    }
  );

  fastify.post(
    '/:id/delivery-settlement',
    {
      preHandler: fastify.requirePermission(MODULES.BOOKING, ACTIONS.EDIT),
    },
    async (request) => {
      const body = validate(orderDeliverySettlementBodySchema, request.body || {});
      const result = await settleOrderDelivery(
        request.shopId,
        request.params.id,
        body,
        request.authUser.id
      );
      if (!result.replayed) {
        scheduleOrderSideEffects(request, [
          request.audit('orders', 'DELIVERY_SETTLEMENT', {
            id: request.params.id,
            new: {
              discount_total: body.discount_total,
              deposit_amount: body.deposit_amount,
              security_amount: body.security_amount,
              receive_amount: body.receive_amount,
              stage_update_count: body.stage_updates.length,
            },
          }),
          logBookingFromOrder(
            knex,
            request.shopId,
            result.order,
            'DELIVERY_SETTLEMENT',
            request.authUser
          ),
        ]);
      }
      return { ok: true, data: result.order, payments: result.payments, replayed: result.replayed };
    }
  );

  fastify.post(
    '/:id/return-settlement',
    {
      preHandler: fastify.requirePermission(MODULES.BOOKING, ACTIONS.EDIT),
    },
    async (request) => {
      const body = validate(orderReturnSettlementBodySchema, request.body || {});
      const result = await settleOrderReturn(
        request.shopId,
        request.params.id,
        body,
        request.authUser.id
      );
      if (!result.replayed) scheduleOrderSideEffects(request, [
        request.audit('orders', 'RETURN_SETTLEMENT', {
          id: request.params.id,
          new: {
            discount_total: body.discount_total,
            security_refund_amount: body.security_refund_amount,
            receive_amount: body.receive_amount,
            stage_update_count: body.stage_updates.length,
          },
        }),
        logBookingFromOrder(
          knex,
          request.shopId,
          result.order,
          'RETURN_SETTLEMENT',
          request.authUser
        ),
      ]);
      return {
        ok: true,
        data: result.order,
        payments: result.payments,
        reminder_id: result.reminder_id,
        condition_charges: result.condition_charges,
        replayed: result.replayed,
      };
    }
  );

  fastify.post('/:id/checklist-combined-charge', async (request) => {
    const body = validate(orderChecklistCombinedChargeBodySchema, request.body || {});
    const orderRow = await knex('orders')
      .where({ id: request.params.id, shop_id: request.shopId })
      .select('id', 'customer_id')
      .first();
    if (!orderRow) throw notFound('Order not found');
    const data = await syncCombinedChecklistSecurityCharge(knex, {
      shopId: request.shopId,
      orderId: orderRow.id,
      customerId: orderRow.customer_id,
      amount: body.amount,
      remarks: body.remarks,
      paymentAccountId: body.payment_account_id,
      userId: request.authUser.id,
    });
    await request.audit('orders', 'CHECKLIST_COMBINED_CHARGE', {
      id: orderRow.id,
      new: data,
    });
    await logBookingById(knex, request.shopId, orderRow.id, 'UPDATE_CONDITION', request.authUser);
    return { ok: true, data };
  });

  fastify.post('/:id/condition', async (request) => {
    const body = validate(orderSetConditionBodySchema, request.body || {});
    const { item_id, item_type, skip_checklist_line_security_sync, ...patch } = body;
    const data = await updateItemCondition(
      request.shopId,
      request.params.id,
      item_id,
      item_type || 'item',
      patch,
      request.authUser.id,
      { skipLineSecuritySync: !!skip_checklist_line_security_sync }
    );
    await request.audit('orders', 'UPDATE_CONDITION', {
      id: request.params.id,
      new: { item_id, item_type, ...patch },
    });
    await logBookingById(
      knex,
      request.shopId,
      request.params.id,
      'UPDATE_CONDITION',
      request.authUser
    );
    return { ok: true, data };
  });

  fastify.post('/:id/cancel', async (request) => {
    const body = validate(cancelOrderBodySchema, request.body || {});
    const data = await cancelOrder(request.shopId, request.params.id, request.authUser.id, body);
    await request.audit('orders', 'CANCEL', { id: request.params.id, new: body });
    await logBookingFromOrder(knex, request.shopId, data, 'CANCEL', request.authUser);
    return { ok: true, data };
  });

  fastify.post('/:id/discount-total', async (request) => {
    const body = validate(orderAdjustDiscountTotalBodySchema, request.body || {});
    const data = await adjustOrderDiscountTotal(
      request.shopId,
      request.params.id,
      body.discount_total,
      request.authUser.id
    );
    await request.audit('orders', 'ADJUST_DISCOUNT_TOTAL', {
      id: request.params.id,
      new: { discount_total: body.discount_total },
    });
    await logBookingFromOrder(
      knex,
      request.shopId,
      data,
      'ADJUST_DISCOUNT_TOTAL',
      request.authUser
    );
    return { ok: true, data };
  });

  fastify.post('/:id/security-status', async (request) => {
    const payload = {
      status: String(request.body?.status || '')
        .trim()
        .toLowerCase(),
      deposit_amount: Number(request.body?.deposit_amount ?? 0),
    };
    const data = await updateOrderSecurityStatus(
      request.shopId,
      request.params.id,
      payload,
      request.authUser.id
    );
    await request.audit('orders', 'UPDATE_SECURITY_STATUS', {
      id: request.params.id,
      new: payload,
    });
    await logBookingFromOrder(
      knex,
      request.shopId,
      data,
      'UPDATE_SECURITY_STATUS',
      request.authUser
    );
    return { ok: true, data };
  });

  fastify.delete(
    '/:id',
    {
      preHandler: [
        fastify.requirePermission(MODULES.BOOKING, ACTIONS.DELETE),
        fastify.requireShopAdminPassword,
      ],
    },
    async (request) => {
      const old = await getOrder(request.shopId, request.params.id);
      if (!old) throw notFound('Order not found');
      await logBookingFromOrder(knex, request.shopId, old, 'DELETE', request.authUser);
      await deleteOrder(request.shopId, request.params.id, request.authUser.id);
      await request.audit('orders', 'DELETE', { id: request.params.id, old });
      return { ok: true };
    }
  );
}
