import { ACTIONS, MODULES } from '@wrs/shared';

import knex from '../../db/knex.js';
import { validate } from '../../utils/validate.js';

import { orderItemReplacementSchema, replacementListSchema, replacementRouteParamsSchema } from './schema.js';
import { listOrderReplacementRequirements, replaceOrderItem } from './service.js';

export default async function orderReplacementRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);
  fastify.get('/orders/:orderId', {
    preHandler: fastify.requirePermission(MODULES.BOOKING, ACTIONS.VIEW),
  }, async (request) => {
    const { orderId } = validate(replacementRouteParamsSchema, request.params);
    const query = validate(replacementListSchema, request.query);
    return { ok: true, data: await listOrderReplacementRequirements(knex, request.shopId, orderId, query.direction, query.source_item_ids) };
  });
  fastify.post('/orders/:orderId/items/:itemId', {
    preHandler: fastify.requirePermission(MODULES.BOOKING, ACTIONS.EDIT),
  }, async (request) => {
    const { orderId, itemId } = validate(replacementRouteParamsSchema, request.params);
    const body = validate(orderItemReplacementSchema, request.body);
    return { ok: true, data: await replaceOrderItem(request.shopId, orderId, itemId, body, request.authUser.id) };
  });
}
