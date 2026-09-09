import { v4 as uuid } from 'uuid';

const LEASE_MS = 10 * 60_000;
export const UNCERTAIN_REMINDER_MESSAGE = 'Delivery acknowledgment is uncertain. Check WhatsApp before manually resending; automatic retry is paused.';

export function expiredReminderOutcome(job) {
  if (job.log_status === 'sent') return 'sent';
  if (job.dispatch_started_at && job.log_status !== 'failed') return 'uncertain';
  return 'pending';
}

export function failedReminderOutcome({ dispatched, logStatus, temporary }) {
  if (logStatus === 'sent') return 'sent';
  if (dispatched && logStatus !== 'failed') return 'uncertain';
  return temporary ? 'pending' : 'failed';
}

export async function claimReminder(db) {
  return db.transaction(async (trx) => {
    const row = await trx('whatsapp_scheduled_messages')
      .where({ status: 'pending' }).where('scheduled_for', '<=', trx.fn.now())
      .andWhere((qb) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', trx.fn.now()))
      .orderBy('scheduled_for', 'asc').forUpdate().first();
    if (!row) return null;
    const token = uuid();
    const patch = {
      status: 'processing', lease_token: token,
      lease_expires_at: new Date(Date.now() + LEASE_MS),
      dispatch_started_at: null, message_log_id: null,
      attempt_count: Number(row.attempt_count || 0) + 1,
      updated_at: trx.fn.now(),
    };
    await trx('whatsapp_scheduled_messages').where({ id: row.id }).update(patch);
    await trx('whatsapp_reminder_attempts').insert({
      id: token, job_id: row.id, shop_id: row.shop_id, status: 'claimed',
    });
    return { ...row, ...patch };
  });
}

export async function markReminderDispatch(db, job, logId) {
  await db.transaction(async (trx) => {
    const updated = await trx('whatsapp_scheduled_messages')
      .where({ id: job.id, status: 'processing', lease_token: job.lease_token })
      .where('lease_expires_at', '>', trx.fn.now())
      .update({ dispatch_started_at: trx.fn.now(), message_log_id: logId, updated_at: trx.fn.now() });
    if (!updated) throw new Error('Reminder lease expired before dispatch; message was not sent');
    await trx('whatsapp_reminder_attempts').where({ id: job.lease_token })
      .update({ status: 'dispatching', message_log_id: logId, updated_at: trx.fn.now() });
  });
}

export async function finishReminderAttempt(db, job, patch) {
  return db.transaction(async (trx) => {
    const updated = await trx('whatsapp_scheduled_messages')
      .where({ id: job.id, lease_token: job.lease_token, status: 'processing' })
      .update({ ...patch, lease_expires_at: null, updated_at: trx.fn.now() });
    if (updated) {
      await trx('whatsapp_reminder_attempts').where({ id: job.lease_token }).update({
        status: patch.status === 'pending' ? 'failed' : patch.status,
        error: patch.last_error || null, updated_at: trx.fn.now(),
      });
    }
    return updated;
  });
}

export async function recoverExpiredReminderLeases(db) {
  const acknowledged = await db('whatsapp_scheduled_messages as sm')
    .join('whatsapp_message_logs as ml', 'ml.id', 'sm.message_log_id')
    .where({ 'sm.status': 'uncertain', 'ml.status': 'sent' })
    .select('sm.id', 'sm.lease_token', 'sm.message_log_id');
  for (const row of acknowledged) {
    await db.transaction(async (trx) => {
      const updated = await trx('whatsapp_scheduled_messages')
        .where({ id: row.id, status: 'uncertain', message_log_id: row.message_log_id })
        .update({ status: 'sent', sent_at: trx.fn.now(), last_error: null, updated_at: trx.fn.now() });
      if (updated && row.lease_token) {
        await trx('whatsapp_reminder_attempts').where({ id: row.lease_token })
          .update({ status: 'sent', error: null, updated_at: trx.fn.now() });
      }
    });
  }
  const expired = await db('whatsapp_scheduled_messages')
    .where({ status: 'processing' }).where('lease_expires_at', '<=', db.fn.now()).select('id');
  for (const { id } of expired) {
    await db.transaction(async (trx) => {
      const job = await trx('whatsapp_scheduled_messages')
        .where({ id, status: 'processing' }).where('lease_expires_at', '<=', trx.fn.now())
        .forUpdate().first();
      if (!job) return;
      const log = job.message_log_id
        ? await trx('whatsapp_message_logs').where({ id: job.message_log_id }).first('status') : null;
      const status = expiredReminderOutcome({ ...job, log_status: log?.status });
      const error = status === 'uncertain' ? UNCERTAIN_REMINDER_MESSAGE
        : status === 'pending' ? 'Worker stopped before dispatch; safe to retry' : null;
      await trx('whatsapp_scheduled_messages').where({ id }).update({
        status, lease_expires_at: null, next_attempt_at: null, last_error: error,
        ...(status === 'sent' ? { sent_at: job.sent_at || trx.fn.now() } : {}),
        updated_at: trx.fn.now(),
      });
      await trx('whatsapp_reminder_attempts').where({ id: job.lease_token }).update({
        status: status === 'pending' ? 'failed' : status, error, updated_at: trx.fn.now(),
      });
    });
  }
}
