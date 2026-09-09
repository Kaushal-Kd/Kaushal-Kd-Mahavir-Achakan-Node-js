import {
  MODULES,
  ACTIONS,
  createCustomOrderSchema,
  createProductFromCustomOrderSchema,
  updateCustomOrderSchema,
  customOrderListQuerySchema,
  linkCustomOrderBookingSchema,
} from '@wrs/shared';

import { validate } from '../../utils/validate.js';
import {
  cancelCustomOrder,
  createCustomOrder,
  createProductFromCustomOrder,
  dismissCustomOrderTrialReminder,
  getCustomOrder,
  linkCustomOrderBooking,
  listCustomOrders,
  listCustomOrderTrialReminders,
  updateCustomOrder,
} from './service.js';

export default async function customOrderRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get(
    '/',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.VIEW) },
    async (request) => {
      const query = validate(customOrderListQuerySchema, request.query || {});
      const result = await listCustomOrders(request.shopId, query);
      return { ok: true, ...result };
    }
  );

  fastify.get(
    '/trial-reminders',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.VIEW) },
    async (request) => {
      const result = await listCustomOrderTrialReminders(request.shopId);
      return { ok: true, ...result };
    }
  );

  fastify.post(
    '/:id/dismiss-trial-reminder',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT) },
    async (request) => {
      const data = await dismissCustomOrderTrialReminder(
        request.shopId,
        request.params.id,
        request.authUser.id
      );
      await request.audit('custom_orders', 'UPDATE', {
        id: data.id,
        new: {
          trial_reminder_dismissed_date: data.trial_reminder_dismissed_date,
          trial_reminder_dismissed_kind: data.trial_reminder_dismissed_kind,
        },
      });
      return { ok: true, data };
    }
  );

  fastify.get(
    '/:id',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.VIEW) },
    async (request) => {
      const data = await getCustomOrder(request.shopId, request.params.id);
      return { ok: true, data };
    }
  );

  fastify.post(
    '/',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.CREATE) },
    async (request) => {
      const body = validate(createCustomOrderSchema, request.body || {});
      const data = await createCustomOrder(request.shopId, body, request.authUser.id);
      await request.audit('custom_orders', 'CREATE', { id: data.id, new: data });
      return { ok: true, data };
    }
  );

  fastify.put(
    '/:id',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT) },
    async (request) => {
      const body = validate(updateCustomOrderSchema, request.body || {});
      const data = await updateCustomOrder(
        request.shopId,
        request.params.id,
        body,
        request.authUser.id
      );
      await request.audit('custom_orders', 'UPDATE', { id: data.id, new: data });
      return { ok: true, data };
    }
  );

  fastify.post(
    '/:id/create-product',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT) },
    async (request) => {
      const body = validate(createProductFromCustomOrderSchema, request.body || {});
      const result = await createProductFromCustomOrder(
        request.shopId,
        request.params.id,
        request.authUser.id,
        body
      );
      await request.audit('custom_orders', 'UPDATE', {
        id: result.custom_order.id,
        new: {
          linked_product_id: result.custom_order.linked_product_id,
          generated_product_code: result.custom_order.generated_product_code,
        },
      });
      return { ok: true, data: result };
    }
  );

  fastify.post(
    '/:id/link-booking',
    { preHandler: fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.EDIT) },
    async (request) => {
      const body = validate(linkCustomOrderBookingSchema, request.body || {});
      const data = await linkCustomOrderBooking(
        request.shopId,
        request.params.id,
        body.order_id,
        request.authUser.id
      );
      await request.audit('custom_orders', 'UPDATE', {
        id: data.id,
        new: { linked_order_id: data.linked_order_id },
      });
      return { ok: true, data };
    }
  );

  fastify.delete(
    '/:id',
    {
      preHandler: [
        fastify.requirePermission(MODULES.CUSTOM_ORDERS, ACTIONS.DELETE),
        fastify.requireShopAdminPassword,
      ],
    },
    async (request) => {
      const data = await cancelCustomOrder(
        request.shopId,
        request.params.id,
        request.authUser.id
      );
      await request.audit('custom_orders', 'UPDATE', {
        id: data.id,
        new: { status: 'cancelled' },
      });
      return { ok: true, data };
    }
  );
}
