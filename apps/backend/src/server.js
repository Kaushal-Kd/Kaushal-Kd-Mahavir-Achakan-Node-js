import { fileURLToPath } from 'node:url';

import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { TRUSTED_PROXY_HOPS } from './lib/trustedProxy.js';
import { normalizeInstantFieldsDeep } from './utils/normalizeApiTimestamps.js';
import accessoryRoutes from './modules/accessories/routes.js';
import authRoutes from './modules/auth/routes.js';
import billTemplateRoutes from './modules/bill-templates/routes.js';
import categoryRoutes from './modules/categories/routes.js';
import configurationRoutes from './modules/configurations/routes.js';
import customerRoutes from './modules/customers/routes.js';
import customOrderRoutes from './modules/custom-orders/routes.js';
import customOrderFieldRoutes from './modules/custom-order-fields/routes.js';
import dashboardRoutes from './modules/dashboard/routes.js';
import draftRoutes from './modules/drafts/routes.js';
import expenseEntryRoutes from './modules/expense-entries/routes.js';
import gstRoutes from './modules/gst/routes.js';
import importRoutes from './modules/imports/routes.js';
import ipWhitelistRoutes from './modules/ip-whitelist/routes.js';
import incomeEntryRoutes from './modules/income-entries/routes.js';
import journalVoucherRoutes from './modules/journal-vouchers/routes.js';
import laundryRoutes from './modules/laundry/routes.js';
import orderRoutes from './modules/orders/routes.js';
import orderReplacementRoutes from './modules/order-replacements/routes.js';
import paymentAccountRoutes from './modules/payment-accounts/routes.js';
import paymentVoucherRoutes from './modules/payment-vouchers/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import productRoutes from './modules/products/routes.js';
import receiptVoucherRoutes from './modules/receipt-vouchers/routes.js';
import creditNoteRoutes from './modules/credit-notes/routes.js';
import reminderRoutes from './modules/reminders/routes.js';
import reportRoutes from './modules/reports/routes.js';
import roleRoutes from './modules/roles/routes.js';
import securityAccountRoutes from './modules/security-accounts/routes.js';
import securityChargeRoutes from './modules/security-charges/routes.js';
import shopRoutes from './modules/shops/routes.js';
import shopEmailRoutes from './modules/shop-email/routes.js';
import timeSlotRoutes from './modules/time-slots/routes.js';
import uploadRoutes from './modules/uploads/routes.js';
import userRoutes from './modules/users/routes.js';
import washingQueueRoutes from './modules/washing-queue/routes.js';
import saleRoutes from './modules/sales/routes.js';
import purchaseRoutes from './modules/purchases/routes.js';
import whatsappRoutes from './modules/whatsapp/routes.js';
import systemLogRoutes from './modules/system-logs/routes.js';
import { reconnectPersistedSessions } from './modules/whatsapp/service.js';
import { startWhatsAppReminderWorker } from './modules/whatsapp/reminderService.js';
import auditPlugin from './plugins/audit.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/errorHandler.js';

export async function build() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.IS_DEV
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: TRUSTED_PROXY_HOPS,
  });

  await app.register(fastifyCompress, { global: true, threshold: 1024 });
  await app.register(fastifyHelmet, { global: true, crossOriginResourcePolicy: false });
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (env.CORS_ORIGIN.includes('*') || env.CORS_ORIGIN.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  });
  await app.register(fastifyRateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(fastifySensible);

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin);

  app.addHook('onRequest', async (request) => {
    request._perfStart = process.hrtime.bigint();
  });

  app.addHook('preSerialization', async (_request, _reply, payload) => {
    if (payload && typeof payload === 'object') {
      normalizeInstantFieldsDeep(payload);
    }
    return payload;
  });

  const perfLogAll = process.env.PERF_LOG_ALL === '1';

  app.addHook('onResponse', async (request, reply) => {
    const start = request._perfStart;
    if (!start) return;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const rounded = Math.round(durationMs);
    if (perfLogAll) {
      request.log.info(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          durationMs: rounded,
        },
        'request timing'
      );
    }
    if (durationMs >= 500) {
      request.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          durationMs: rounded,
        },
        'slow request'
      );
    }
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'wrs-backend',
    env: env.NODE_ENV,
    time: new Date().toISOString(),
  }));

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(shopRoutes, { prefix: '/api/shops' });
  app.register(shopEmailRoutes, { prefix: '/api/shop-email-settings' });
  app.register(userRoutes, { prefix: '/api/users' });
  app.register(roleRoutes, { prefix: '/api/roles' });
  app.register(customerRoutes, { prefix: '/api/customers' });
  app.register(customOrderRoutes, { prefix: '/api/custom-orders' });
  app.register(customOrderFieldRoutes, { prefix: '/api/custom-order-fields' });
  app.register(categoryRoutes, { prefix: '/api/categories' });
  app.register(timeSlotRoutes, { prefix: '/api/time-slots' });
  app.register(configurationRoutes, { prefix: '/api/configurations' });
  app.register(productRoutes, { prefix: '/api/products' });
  app.register(accessoryRoutes, { prefix: '/api/accessories' });
  app.register(orderRoutes, { prefix: '/api/orders' });
  app.register(orderReplacementRoutes, { prefix: '/api/order-replacements' });
  app.register(paymentRoutes, { prefix: '/api/payments' });
  app.register(paymentAccountRoutes, { prefix: '/api/payment-accounts' });
  app.register(securityAccountRoutes, { prefix: '/api/security-accounts' });
  app.register(securityChargeRoutes, { prefix: '/api/security-charges' });
  app.register(reportRoutes, { prefix: '/api/reports' });
  app.register(gstRoutes, { prefix: '/api/gst' });
  app.register(billTemplateRoutes, { prefix: '/api/bill-templates' });
  app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  app.register(draftRoutes, { prefix: '/api/drafts' });
  app.register(reminderRoutes, { prefix: '/api/reminders' });
  app.register(laundryRoutes, { prefix: '/api/laundry' });
  app.register(uploadRoutes, { prefix: '/api/uploads' });
  app.register(importRoutes, { prefix: '/api/imports' });
  app.register(ipWhitelistRoutes, { prefix: '/api/ip-whitelist' });
  app.register(incomeEntryRoutes, { prefix: '/api/income-entries' });
  app.register(expenseEntryRoutes, { prefix: '/api/expense-entries' });
  app.register(journalVoucherRoutes, { prefix: '/api/journal-vouchers' });
  app.register(receiptVoucherRoutes, { prefix: '/api/receipt-vouchers' });
  app.register(creditNoteRoutes, { prefix: '/api/credit-notes' });
  app.register(paymentVoucherRoutes, { prefix: '/api/payment-vouchers' });
  app.register(washingQueueRoutes, { prefix: '/api/washing-queue' });
  app.register(saleRoutes, { prefix: '/api/sales' });
  app.register(purchaseRoutes, { prefix: '/api/purchases' });
  app.register(whatsappRoutes, { prefix: '/api/whatsapp' });
  app.register(systemLogRoutes, { prefix: '/api/system-logs' });

  return app;
}

async function start() {
  const app = await build();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    reconnectPersistedSessions().catch((err) => {
      app.log.warn({ err }, '[whatsapp] startup reconnect failed');
    });
    startWhatsAppReminderWorker();
    if (env.GCS_ENABLED) {
      app.log.info(
        `[gcs] enabled \u2014 project=${env.GCS_PROJECT_ID} bucket=${env.GCS_BUCKET_NAME || '(unset)'} client=${
          env.GCS_CREDENTIALS?.clientEmail || 'unknown'
        }`
      );
    } else {
      app.log.warn(
        '[gcs] disabled \u2014 set GCS_KEY_FILE or GCS_CREDENTIALS_JSON to enable uploads'
      );
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const entryFile = process.argv[1];
const currentFile = fileURLToPath(import.meta.url);

if (entryFile && currentFile === entryFile) {
  start();
}
