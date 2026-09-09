import {
  addDays,
  normalizeSqlDateToIso,
  parseYesNo,
  todayIndiaISODate,
} from '@wrs/shared';
import { normalizeWhatsAppRecipient } from '@wrs/shared/utils/whatsappRecipient.js';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';

import {
  DELIVERY_REMINDER_ORDER_STATUSES,
  canReactivateDeliveryReminder,
  deliveryReminderCancellationReason,
  deliveryReminderScheduledAt,
} from './reminderEligibility.js';
import {
  UNCERTAIN_REMINDER_MESSAGE,
  claimReminder,
  failedReminderOutcome,
  finishReminderAttempt,
  markReminderDispatch,
  recoverExpiredReminderLeases,
} from './reminderLease.js';
import { sendWhatsAppMessage } from './service.js';

const REMINDER_TEMPLATE = 'DELIVERY_REMINDER';
const ENABLED_KEY = 'whatsapp.delivery_reminder_enabled';
const TIME_KEY = 'whatsapp.delivery_reminder_time';
const WORK_INTERVAL_MS = 60_000;
let workerTimer = null;
let workerRunning = false;

async function settingMap(shopId) {
  const rows = await knex('settings')
    .where({ shop_id: shopId })
    .whereIn('key', [ENABLED_KEY, TIME_KEY]);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function ensureTomorrowJobs() {
  const tomorrow = normalizeSqlDateToIso(addDays(todayIndiaISODate(), 1));
  const shops = await knex('shops').where({ is_active: true }).select('id');
  for (const shop of shops) {
    const settings = await settingMap(shop.id);
    if (!parseYesNo(settings[ENABLED_KEY], 'No')) continue;
    const orders = await knex('orders')
      .where({ shop_id: shop.id, pickup_date: tomorrow, is_deleted: false })
      .whereIn('status', DELIVERY_REMINDER_ORDER_STATUSES)
      .select('id', 'pickup_date');
    for (const order of orders) {
      const scheduledFor = deliveryReminderScheduledAt(tomorrow, settings[TIME_KEY]);
      const exists = await knex('whatsapp_scheduled_messages')
        .where({
          shop_id: shop.id,
          order_id: order.id,
          template_key: REMINDER_TEMPLATE,
          delivery_date: tomorrow,
        })
        .first();
      if (exists) {
        if (exists.status === 'pending' || canReactivateDeliveryReminder(exists)) {
          await knex('whatsapp_scheduled_messages').where({ id: exists.id, status: exists.status }).update({
            scheduled_for: scheduledFor,
            ...(canReactivateDeliveryReminder(exists)
              ? { status: 'pending', next_attempt_at: null, last_error: null }
              : {}),
            updated_at: knex.fn.now(),
          });
        }
        continue;
      }
      try {
        await knex('whatsapp_scheduled_messages').insert({
          id: uuid(),
          shop_id: shop.id,
          order_id: order.id,
          template_key: REMINDER_TEMPLATE,
          delivery_date: tomorrow,
          scheduled_for: scheduledFor,
          status: 'pending',
          attempt_count: 0,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY' && error?.errno !== 1062) throw error;
      }
    }
  }
}

async function loadReminderOrder(job) {
  return knex('orders as o')
    .leftJoin('customers as c', function joinCustomer() {
      this.on('c.id', '=', 'o.customer_id').andOn('c.shop_id', '=', 'o.shop_id');
    })
    .where({ 'o.id': job.order_id, 'o.shop_id': job.shop_id, 'o.is_deleted': false })
    .select(
      'o.*',
      'c.whatsapp as customer_whatsapp',
      'c.phone1 as customer_phone1',
      'c.phone2 as customer_phone2'
    )
    .first();
}

function reminderPhone(order) {
  return [order.customer_whatsapp, order.customer_phone1, order.customer_phone2, order.pickup_number]
    .map(normalizeWhatsAppRecipient)
    .find(Boolean);
}

function temporaryError(message) {
  return /not connected|connection|timeout|temporar|socket|network/i.test(String(message || ''));
}

async function processJob(job, sendMessage) {
  const today = todayIndiaISODate();
  const deliveryDate = normalizeSqlDateToIso(job.delivery_date);
  if (!deliveryDate || deliveryDate <= today) {
    await finishReminderAttempt(knex, job, {
      status: 'cancelled',
      last_error: 'Delivery date reached before reminder could be sent',
      updated_at: knex.fn.now(),
    });
    return;
  }
  const [settings, activeShop] = await Promise.all([
    settingMap(job.shop_id),
    knex('shops').where({ id: job.shop_id, is_active: true }).first('id'),
  ]);
  if (!activeShop) {
    await finishReminderAttempt(knex, job, { status: 'cancelled', last_error: 'Shop is no longer active' });
    return;
  }
  if (!parseYesNo(settings[ENABLED_KEY], 'No')) {
    await finishReminderAttempt(knex, job, {
      status: 'pending',
      next_attempt_at: new Date(Date.now() + 60 * 60_000),
      last_error: 'Automatic delivery reminders are currently disabled',
      updated_at: knex.fn.now(),
    });
    return;
  }
  const order = await loadReminderOrder(job);
  const cancellationReason = deliveryReminderCancellationReason(job, order, today);
  if (cancellationReason) {
    await finishReminderAttempt(knex, job, {
      status: 'cancelled',
      last_error: cancellationReason,
      updated_at: knex.fn.now(),
    });
    return;
  }
  const phone = reminderPhone(order);
  if (!phone) {
    await finishReminderAttempt(knex, job, {
      status: 'failed',
      last_error: 'Customer has no valid WhatsApp number',
      updated_at: knex.fn.now(),
    });
    return;
  }
  let cancellationBeforeDispatch = null;
  let deferredUntil = null;
  try {
    const result = await sendMessage(job.shop_id, null, {
      template_key: REMINDER_TEMPLATE,
      phone,
      order_id: order.id,
    }, {
      beforeDispatch: async ({ logId }) => {
        const [currentOrder, currentSettings, shop] = await Promise.all([
          loadReminderOrder(job), settingMap(job.shop_id),
          knex('shops').where({ id: job.shop_id, is_active: true }).first('id'),
        ]);
        cancellationBeforeDispatch = !shop ? 'Shop is no longer active'
          : !parseYesNo(currentSettings[ENABLED_KEY], 'No') ? 'Automatic reminders were disabled before dispatch'
            : deliveryReminderCancellationReason(job, currentOrder, todayIndiaISODate());
        if (!cancellationBeforeDispatch && reminderPhone(currentOrder) !== phone) {
          cancellationBeforeDispatch = 'Customer WhatsApp number changed before dispatch';
        }
        if (cancellationBeforeDispatch) throw new Error(cancellationBeforeDispatch);
        const currentScheduledFor = deliveryReminderScheduledAt(deliveryDate, currentSettings[TIME_KEY]);
        if (currentScheduledFor.getTime() > Date.now()) {
          deferredUntil = currentScheduledFor;
          throw new Error('Automatic reminder time changed before dispatch');
        }
        await markReminderDispatch(knex, job, logId);
      },
    });
    await finishReminderAttempt(knex, job, {
      status: 'sent',
      sent_at: knex.fn.now(),
      message_log_id: result.id,
      last_error: null,
      updated_at: knex.fn.now(),
    });
  } catch (error) {
    if (deferredUntil) {
      await finishReminderAttempt(knex, job, {
        status: 'pending', scheduled_for: deferredUntil, next_attempt_at: deferredUntil,
        last_error: 'Waiting for the updated automatic reminder time',
      });
      return;
    }
    if (cancellationBeforeDispatch) {
      await finishReminderAttempt(knex, job, { status: 'cancelled', last_error: cancellationBeforeDispatch });
      return;
    }
    const attempts = Number(job.attempt_count || 1);
    const message = error?.message || 'Reminder send failed';
    const stored = await knex('whatsapp_scheduled_messages').where({ id: job.id, lease_token: job.lease_token }).first();
    const log = stored?.message_log_id
      ? await knex('whatsapp_message_logs').where({ id: stored.message_log_id }).first('status') : null;
    const status = failedReminderOutcome({
      dispatched: Boolean(stored?.dispatch_started_at), logStatus: log?.status, temporary: temporaryError(message),
    });
    const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
    await finishReminderAttempt(knex, job, {
      status,
      attempt_count: attempts,
      next_attempt_at: status === 'pending' ? new Date(Date.now() + delayMinutes * 60_000) : null,
      last_error: status === 'uncertain' ? UNCERTAIN_REMINDER_MESSAGE : status === 'sent' ? null : message,
      ...(status === 'sent' ? { sent_at: knex.fn.now() } : {}),
      updated_at: knex.fn.now(),
    });
  }
}

export async function runWhatsAppReminderPass({ sendMessage = sendWhatsAppMessage } = {}) {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await ensureTomorrowJobs();
    await recoverExpiredReminderLeases(knex);
    for (;;) {
      const job = await claimReminder(knex);
      if (!job) break;
      await processJob(job, sendMessage);
    }
  } finally {
    workerRunning = false;
  }
}

export function startWhatsAppReminderWorker() {
  if (workerTimer) return workerTimer;
  runWhatsAppReminderPass().catch((error) => console.warn('[whatsapp] reminder pass failed:', error?.message || error));
  workerTimer = setInterval(() => {
    runWhatsAppReminderPass().catch((error) => console.warn('[whatsapp] reminder pass failed:', error?.message || error));
  }, WORK_INTERVAL_MS);
  workerTimer.unref?.();
  return workerTimer;
}

export async function listScheduledMessages(shopId, query) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.per_page) || 20));
  const base = knex('whatsapp_scheduled_messages as sm')
    .join('orders as o', 'o.id', 'sm.order_id')
    .where('sm.shop_id', shopId);
  if (query.status !== 'all') base.andWhere('sm.status', query.status);
  const [{ total }] = await base.clone().clearSelect().count({ total: '*' });
  const rows = await base
    .select('sm.*', 'o.order_number')
    .orderBy('sm.scheduled_for', 'desc')
    .offset((page - 1) * perPage)
    .limit(perPage);
  return { rows, meta: { page, per_page: perPage, total: Number(total || 0) } };
}

export { ensureTomorrowJobs as ensureWhatsAppReminderJobs };
