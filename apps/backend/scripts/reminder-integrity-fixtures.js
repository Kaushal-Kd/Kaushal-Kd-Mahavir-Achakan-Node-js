import assert from 'node:assert/strict';

import { addDays, normalizeSqlDateToIso, todayIndiaISODate } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import { deliveryReminderScheduledAt } from '../src/modules/whatsapp/reminderEligibility.js';
import { finishReminderAttempt, markReminderDispatch } from '../src/modules/whatsapp/reminderLease.js';
import { runWhatsAppReminderPass } from '../src/modules/whatsapp/reminderService.js';

export async function runReminderIntegrityFixtures({ db, shopId, createOrder }) {
  const tomorrow = normalizeSqlDateToIso(addDays(todayIndiaISODate(), 1));
  for (const [key, value] of [
    ['whatsapp.delivery_reminder_enabled', 'Yes'],
    ['whatsapp.delivery_reminder_time', '00:00'],
  ]) {
    await db('settings').insert({ id: uuid(), shop_id: shopId, key, value })
      .onConflict(['shop_id', 'key']).merge({ value });
  }
  const eligible = await createOrder({ prepared: false });
  const stale = await createOrder({ prepared: false });
  const ready = await createOrder({ prepared: true });
  const retry = await createOrder({ prepared: false });
  await db('orders').whereIn('id', [eligible.orderId, ready.orderId, retry.orderId]).update({ pickup_date: tomorrow });
  await db('orders').whereIn('id', [eligible.orderId, stale.orderId, retry.orderId]).update({ status: 'in_preparation' });
  await db('orders').where({ id: stale.orderId }).update({ pickup_date: normalizeSqlDateToIso(addDays(tomorrow, 2)) });
  for (const orderId of [stale.orderId, ready.orderId]) {
    await db('whatsapp_scheduled_messages').insert({
      id: uuid(), shop_id: shopId, order_id: orderId, template_key: 'DELIVERY_REMINDER',
      delivery_date: tomorrow, scheduled_for: new Date(Date.now() - 1000), status: 'pending',
    });
  }
  const calls = [];
  const allowedOrders = new Set([eligible.orderId, retry.orderId]);
  const uncertainTargets = new Set();
  const beforeDispatchChanges = new Map();
  let simulateDisconnect = true;
  const sendMessage = async (_shop, _user, payload, { beforeDispatch }) => {
    assert.ok(allowedOrders.has(payload.order_id), 'ineligible or stale booking must never send');
    calls.push(payload.order_id);
    if (payload.order_id === retry.orderId && simulateDisconnect) throw new Error('WhatsApp is not connected');
    const id = uuid();
    await db('whatsapp_message_logs').insert({
      id, shop_id: shopId, template_key: 'DELIVERY_REMINDER', recipient_phone: '9999999999',
      recipient_jid: 'fixture-only', body_preview: 'Simulated reminder; no provider call', status: 'queued', order_id: payload.order_id,
    });
    await beforeDispatchChanges.get(payload.order_id)?.();
    try {
      await beforeDispatch({ logId: id });
    } catch (error) {
      await db('whatsapp_message_logs').where({ id }).update({ status: 'failed' });
      throw error;
    }
    if (uncertainTargets.has(payload.order_id)) {
      await db('whatsapp_message_logs').where({ id }).update({ status: 'uncertain' });
      throw new Error('Network timeout after dispatch; acknowledgment unknown');
    }
    await db('whatsapp_message_logs').where({ id }).update({ status: 'sent' });
    return { id };
  };
  await runWhatsAppReminderPass({ sendMessage });
  const firstJobs = await db('whatsapp_scheduled_messages').where({ shop_id: shopId });
  assert.equal(firstJobs.find((row) => row.order_id === eligible.orderId).status, 'sent');
  assert.equal(firstJobs.find((row) => row.order_id === stale.orderId).status, 'cancelled');
  assert.equal(firstJobs.find((row) => row.order_id === ready.orderId).status, 'cancelled');
  assert.equal(firstJobs.find((row) => row.order_id === retry.orderId).status, 'pending');
  simulateDisconnect = false;
  await db('whatsapp_scheduled_messages').where({ order_id: retry.orderId }).update({ next_attempt_at: new Date(Date.now() - 1000) });
  await runWhatsAppReminderPass({ sendMessage });
  await runWhatsAppReminderPass({ sendMessage });
  assert.equal(calls.filter((id) => id === eligible.orderId).length, 1, 'sent reminders must not repeat');
  assert.equal(calls.filter((id) => id === retry.orderId).length, 2, 'disconnected reminder retries once successfully');

  const crashCases = [];
  for (const kind of ['before_dispatch', 'after_dispatch', 'after_ack']) {
    const booking = await createOrder({ prepared: false });
    await db('orders').where({ id: booking.orderId }).update({ status: 'in_preparation', pickup_date: tomorrow });
    const token = uuid();
    const jobId = uuid();
    const logId = kind === 'before_dispatch' ? null : uuid();
    if (logId) {
      await db('whatsapp_message_logs').insert({
        id: logId, shop_id: shopId, template_key: 'DELIVERY_REMINDER',
        recipient_phone: '9999999999', recipient_jid: 'fixture-only',
        status: kind === 'after_ack' ? 'sent' : 'queued', order_id: booking.orderId,
      });
    }
    const job = {
      id: jobId, shop_id: shopId, order_id: booking.orderId, template_key: 'DELIVERY_REMINDER',
      delivery_date: tomorrow, scheduled_for: new Date(Date.now() - 1000), status: 'processing',
      lease_token: token, lease_expires_at: new Date(Date.now() - 1000),
      dispatch_started_at: kind === 'before_dispatch' ? null : new Date(Date.now() - 2000),
      message_log_id: logId, attempt_count: 1,
    };
    await db('whatsapp_scheduled_messages').insert(job);
    await db('whatsapp_reminder_attempts').insert({
      id: token, shop_id: shopId, job_id: jobId,
      status: kind === 'before_dispatch' ? 'claimed' : 'dispatching', message_log_id: logId,
    });
    if (kind === 'before_dispatch') allowedOrders.add(booking.orderId);
    crashCases.push({ kind, job, booking });
  }
  const uncertain = await createOrder({ prepared: false });
  await db('orders').where({ id: uncertain.orderId }).update({ status: 'in_preparation', pickup_date: tomorrow });
  allowedOrders.add(uncertain.orderId);
  uncertainTargets.add(uncertain.orderId);
  await runWhatsAppReminderPass({ sendMessage });
  await runWhatsAppReminderPass({ sendMessage });
  for (const { kind, job, booking } of crashCases) {
    const persisted = await db('whatsapp_scheduled_messages').where({ id: job.id }).first();
    assert.equal(persisted.status, kind === 'after_dispatch' ? 'uncertain' : 'sent');
    assert.equal(calls.filter((id) => id === booking.orderId).length, kind === 'before_dispatch' ? 1 : 0);
    assert.equal(await finishReminderAttempt(db, job, { status: 'failed' }), 0, 'stale lease cannot overwrite recovered result');
    await assert.rejects(markReminderDispatch(db, job, uuid()), /lease expired/i);
  }
  assert.equal((await db('whatsapp_scheduled_messages').where({ order_id: uncertain.orderId }).first()).status, 'uncertain');
  assert.equal(calls.filter((id) => id === uncertain.orderId).length, 1, 'unknown acknowledgment must never auto-resend');
  const lateAck = crashCases.find((entry) => entry.kind === 'after_dispatch');
  await db('whatsapp_message_logs').where({ id: lateAck.job.message_log_id }).update({ status: 'sent' });
  await runWhatsAppReminderPass({ sendMessage });
  assert.equal((await db('whatsapp_scheduled_messages').where({ id: lateAck.job.id }).first()).status, 'sent');
  assert.equal(calls.filter((id) => id === lateAck.booking.orderId).length, 0, 'late acknowledgment reconciles without sending again');
  const changedAtDispatch = await createOrder({ prepared: false });
  await db('orders').where({ id: changedAtDispatch.orderId }).update({ status: 'in_preparation', pickup_date: tomorrow });
  allowedOrders.add(changedAtDispatch.orderId);
  beforeDispatchChanges.set(changedAtDispatch.orderId, () =>
    db('orders').where({ id: changedAtDispatch.orderId }).update({ status: 'ready_for_delivery' })
  );
  await runWhatsAppReminderPass({ sendMessage });
  const changedJob = await db('whatsapp_scheduled_messages').where({ order_id: changedAtDispatch.orderId }).first();
  assert.equal(changedJob.status, 'cancelled');
  assert.equal(changedJob.dispatch_started_at, null, 'changed eligibility must be rechecked immediately before provider dispatch');
  const changedRecipient = await createOrder({ prepared: false });
  await db('orders').where({ id: changedRecipient.orderId }).update({ status: 'in_preparation', pickup_date: tomorrow });
  const recipientOrder = await db('orders').where({ id: changedRecipient.orderId }).first('customer_id');
  const recipientCustomer = await db('customers').where({ id: recipientOrder.customer_id }).first('whatsapp');
  allowedOrders.add(changedRecipient.orderId);
  beforeDispatchChanges.set(changedRecipient.orderId, () =>
    db('customers').where({ id: recipientOrder.customer_id }).update({ whatsapp: '9876543210' })
  );
  try {
    await runWhatsAppReminderPass({ sendMessage });
    const recipientJob = await db('whatsapp_scheduled_messages').where({ order_id: changedRecipient.orderId }).first();
    assert.equal(recipientJob.status, 'cancelled');
    assert.equal(recipientJob.dispatch_started_at, null, 'old customer number must not receive the reminder');
  } finally {
    await db('customers').where({ id: recipientOrder.customer_id }).update({ whatsapp: recipientCustomer.whatsapp });
    await db('orders').where({ id: changedRecipient.orderId }).update({ status: 'ready_for_delivery' });
  }
  if (deliveryReminderScheduledAt(tomorrow, '23:59').getTime() > Date.now()) {
    const changedTime = await createOrder({ prepared: false });
    await db('orders').where({ id: changedTime.orderId }).update({ status: 'in_preparation', pickup_date: tomorrow });
    allowedOrders.add(changedTime.orderId);
    beforeDispatchChanges.set(changedTime.orderId, () =>
      db('settings').where({ shop_id: shopId, key: 'whatsapp.delivery_reminder_time' }).update({ value: '23:59' })
    );
    try {
      await runWhatsAppReminderPass({ sendMessage });
      const changedTimeJob = await db('whatsapp_scheduled_messages').where({ order_id: changedTime.orderId }).first();
      assert.equal(changedTimeJob.status, 'pending');
      assert.equal(changedTimeJob.dispatch_started_at, null, 'later reminder time must delay an already claimed job');
    } finally {
      await db('settings').where({ shop_id: shopId, key: 'whatsapp.delivery_reminder_time' }).update({ value: '00:00' });
      await db('orders').where({ id: changedTime.orderId }).update({ status: 'ready_for_delivery' });
    }
  }
  const inactive = await createOrder({ prepared: false });
  await db('orders').where({ id: inactive.orderId }).update({ status: 'in_preparation', pickup_date: tomorrow });
  await db('whatsapp_scheduled_messages').insert({
    id: uuid(), shop_id: shopId, order_id: inactive.orderId, template_key: 'DELIVERY_REMINDER',
    delivery_date: tomorrow, scheduled_for: new Date(Date.now() - 1000), status: 'pending',
  });
  await db('shops').where({ id: shopId }).update({ is_active: false });
  try {
    await runWhatsAppReminderPass({ sendMessage });
    assert.equal((await db('whatsapp_scheduled_messages').where({ order_id: inactive.orderId }).first()).status, 'cancelled');
    assert.equal(calls.includes(inactive.orderId), false, 'inactive shops must not send existing pending reminders');
  } finally {
    await db('shops').where({ id: shopId }).update({ is_active: true });
  }
  process.stdout.write('Reminder integrity: eligibility, retries, durable leases, crash recovery and uncertain acknowledgments passed with fake sender.\n');
}
