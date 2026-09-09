import { whatsappReminderQuerySchema, whatsappResendSchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

import { logsQuerySchema, sendWhatsAppMessageSchema } from './schema.js';
import {
  getConnectionPayload,
  getQrPayload,
  listConnectionLogs,
  listMessageLogs,
  logoutConnection,
  sendWhatsAppMessage,
  startConnection,
} from './service.js';
import { listScheduledMessages, runWhatsAppReminderPass } from './reminderService.js';

export default async function whatsappRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/connection', async (request) => {
    const data = await getConnectionPayload(request.shopId);
    return { ok: true, data };
  });

  fastify.post('/connection/start', async (request) => {
    const data = await startConnection(request.shopId, request.authUser.id);
    return { ok: true, data };
  });

  fastify.get('/connection/qr', async (request) => {
    const data = await getQrPayload(request.shopId);
    return { ok: true, data };
  });

  fastify.post('/connection/logout', async (request) => {
    const data = await logoutConnection(request.shopId, request.authUser.id);
    return { ok: true, data };
  });

  fastify.get('/logs/connection', async (request) => {
    const query = validate(logsQuerySchema, request.query || {});
    const result = await listConnectionLogs(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.get('/logs/messages', async (request) => {
    const query = validate(logsQuerySchema, request.query || {});
    const result = await listMessageLogs(request.shopId, query);
    return { ok: true, ...result };
  });

  fastify.post('/messages/send', async (request) => {
    const body = validate(sendWhatsAppMessageSchema, request.body || {});
    const data = await sendWhatsAppMessage(request.shopId, request.authUser.id, body);
    return { ok: true, data };
  });

  fastify.get('/reminders', async (request) => {
    const query = validate(whatsappReminderQuerySchema, request.query || {});
    return { ok: true, data: await listScheduledMessages(request.shopId, query) };
  });

  fastify.post('/reminders/run', async () => {
    await runWhatsAppReminderPass();
    return { ok: true };
  });

  fastify.post('/messages/resend', async (request) => {
    const body = validate(whatsappResendSchema, request.body || {});
    const order = await knex('orders as o')
      .leftJoin('customers as c', 'c.id', 'o.customer_id')
      .where({ 'o.id': body.order_id, 'o.shop_id': request.shopId })
      .select('o.id', 'o.pickup_number', 'c.whatsapp', 'c.phone1', 'c.phone2')
      .first();
    if (!order) throw notFound('Booking not found');
    const phone = order.whatsapp || order.phone1 || order.phone2 || order.pickup_number;
    if (!phone) throw badRequest('Customer has no WhatsApp number');
    const data = await sendWhatsAppMessage(request.shopId, request.authUser.id, {
      template_key: body.template_key,
      phone,
      order_id: order.id,
      document: body.document,
    });
    return { ok: true, data };
  });
}
