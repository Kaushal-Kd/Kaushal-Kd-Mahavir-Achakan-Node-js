import { shouldAttachBillPdf } from '@wrs/shared';
import { normalizeWhatsAppRecipient } from '@wrs/shared/utils/whatsappRecipient.js';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

import {
  getCachedQrDataUrl,
  getRuntimeSession,
  hasActiveRuntime,
  resumeSession,
  sendDocument,
  sendText,
  startSession,
  stopSession,
} from './baileysManager.js';
import { renderTemplateWithOrderContext } from './messageRender.js';
import { createScopedSessionOperations } from './sessionLifecycle.js';

const SESSION_STATUSES = ['disconnected', 'qr_pending', 'reconnecting', 'connected', 'inactive'];
const runConnectionOperation = createScopedSessionOperations();

export function phoneToJid(phone) {
  const digits = normalizeWhatsAppRecipient(phone);
  if (!digits) return null;
  return `91${digits}@s.whatsapp.net`;
}

async function ensureSessionRow(shopId) {
  const existing = await knex('whatsapp_shop_sessions').where({ shop_id: shopId }).first();
  if (existing) return existing;
  const now = knex.fn.now();
  await knex('whatsapp_shop_sessions').insert({
    shop_id: shopId,
    status: 'disconnected',
    created_at: now,
    updated_at: now,
  });
  return knex('whatsapp_shop_sessions').where({ shop_id: shopId }).first();
}

async function updateSession(shopId, patch) {
  await knex('whatsapp_shop_sessions')
    .where({ shop_id: shopId })
    .update({ ...patch, updated_at: knex.fn.now() });
}

export async function logConnectionEvent(shopId, userId, event, message, meta = null) {
  await knex('whatsapp_connection_logs').insert({
    id: uuid(),
    shop_id: shopId,
    user_id: userId || null,
    event,
    message: message ? String(message).slice(0, 500) : null,
    meta: meta ? JSON.stringify(meta) : null,
    created_at: knex.fn.now(),
  });
}

async function userDisplayName(userId) {
  if (!userId) return null;
  const u = await knex('users').where({ id: userId }).select('name').first();
  return u?.name || null;
}

function sessionHooks(shopId, userId) {
  return {
    onQr: async () => {
      await updateSession(shopId, { status: 'qr_pending', last_error: null });
      await logConnectionEvent(shopId, userId, 'qr_generated', 'QR code ready to scan');
    },
    onConnected: async ({ phone_number, wa_jid, display_name }) => {
      await updateSession(shopId, {
        status: 'connected',
        phone_number,
        wa_jid,
        display_name,
        connected_at: knex.fn.now(),
        disconnected_at: null,
        last_seen_at: knex.fn.now(),
        connected_by_user_id: userId,
        last_login_user_id: userId,
        last_error: null,
        should_reconnect: true,
        disconnect_kind: null,
        reconnect_attempts: 0,
        next_reconnect_at: null,
      });
      await logConnectionEvent(shopId, userId, 'connected', `Linked as ${phone_number || wa_jid}`, {
        display_name,
      });
    },
    onDisconnected: async (reason, meta = {}) => {
      const shouldStopReconnect = ['provider_logout', 'non_transient'].includes(meta.kind);
      await updateSession(shopId, {
        status: 'disconnected',
        disconnected_at: knex.fn.now(),
        last_error: reason ? String(reason).slice(0, 2000) : null,
        disconnect_kind: meta.kind || 'unknown',
        ...(shouldStopReconnect ? { should_reconnect: false, next_reconnect_at: null } : {}),
      });
      await logConnectionEvent(shopId, userId, 'disconnected', reason || 'Connection closed');
    },
    onError: async (message) => {
      await updateSession(shopId, { last_error: message });
      await logConnectionEvent(shopId, userId, 'error', message);
    },
    onReconnecting: async (message, meta = {}) => {
      await updateSession(shopId, {
        status: 'reconnecting',
        last_error: null,
        should_reconnect: true,
        reconnect_attempts: knex.raw('reconnect_attempts + 1'),
        next_reconnect_at: meta.next_reconnect_at || null,
      });
      await logConnectionEvent(shopId, userId, 'reconnect', message || 'Reconnecting session');
    },
  };
}

export async function getConnectionPayload(shopId) {
  await ensureSessionRow(shopId);
  const row = await knex('whatsapp_shop_sessions').where({ shop_id: shopId }).first();
  const runtime = getRuntimeSession(shopId);
  const hasRuntime = hasActiveRuntime(shopId);

  let status;
  if (runtime?.status === 'connected') {
    status = 'connected';
  } else if (runtime?.status === 'reconnecting') {
    status = 'reconnecting';
  } else if (runtime?.qrDataUrl) {
    status = 'qr_pending';
  } else if (runtime?.status === 'qr_pending') {
    status = 'qr_pending';
  } else if (
    (row.status === 'qr_pending' || row.status === 'connected' || row.status === 'reconnecting') &&
    !hasRuntime
  ) {
    status = 'disconnected';
  } else {
    status = row.status || 'disconnected';
  }

  const lastLoginUser = await userDisplayName(row.last_login_user_id);
  const connectedByUser = await userDisplayName(row.connected_by_user_id);
  const lastError =
    status === 'reconnecting' ? null : row.last_error;
  const needsReconnect =
    !hasRuntime &&
    !!row.last_error &&
    /restart required/i.test(String(row.last_error));

  return {
    status,
    phone_number: row.phone_number || runtime?.phoneNumber || null,
    display_name: row.display_name || runtime?.displayName || null,
    wa_jid: row.wa_jid || runtime?.waJid || null,
    connected_at: row.connected_at,
    disconnected_at: row.disconnected_at,
    last_seen_at: row.last_seen_at,
    last_login_user: lastLoginUser,
    connected_by_user: connectedByUser,
    last_error: lastError,
    needs_reconnect: needsReconnect,
    can_send: status === 'connected',
    qr_data_url: status === 'qr_pending' ? getCachedQrDataUrl(shopId) : null,
  };
}

export async function startConnection(shopId, userId) {
  return runConnectionOperation(shopId, async () => {
    await ensureSessionRow(shopId);
    await updateSession(shopId, {
      status: 'qr_pending',
      last_error: null,
      should_reconnect: true,
      disconnect_kind: null,
    });
    await logConnectionEvent(shopId, userId, 'connect_start', 'WhatsApp pairing started');

    await startSession(shopId, sessionHooks(shopId, userId));
    return getConnectionPayload(shopId);
  });
}

export async function getQrPayload(shopId) {
  const payload = await getConnectionPayload(shopId);
  return { qr_data_url: payload.qr_data_url };
}

export async function logoutConnection(shopId, userId) {
  return runConnectionOperation(shopId, async () => {
    await stopSession(shopId, { clearAuth: true });
    await updateSession(shopId, {
      status: 'disconnected',
      phone_number: null,
      wa_jid: null,
      display_name: null,
      disconnected_at: knex.fn.now(),
      last_error: null,
      should_reconnect: false,
      disconnect_kind: 'manual_logout',
      reconnect_attempts: 0,
      next_reconnect_at: null,
    });
    await logConnectionEvent(shopId, userId, 'logout', 'WhatsApp logged out and auth cleared');
    return getConnectionPayload(shopId);
  });
}

export async function listConnectionLogs(shopId, query) {
  const qb = knex('whatsapp_connection_logs as l')
    .leftJoin('users as u', 'u.id', 'l.user_id')
    .where('l.shop_id', shopId)
    .select(
      'l.id',
      'l.event',
      'l.message',
      'l.created_at',
      'l.user_id',
      'u.name as user_name'
    );
  const result = await paginate(qb, {
    ...query,
    sort: query?.sort || '-created_at',
    search_fields: ['l.event', 'l.message', 'u.name'],
  });
  return result;
}

export async function listMessageLogs(shopId, query) {
  const qb = knex('whatsapp_message_logs as l')
    .leftJoin('users as u', 'u.id', 'l.user_id')
    .where('l.shop_id', shopId)
    .select(
      'l.id',
      'l.template_key',
      'l.recipient_phone',
      'l.recipient_jid',
      'l.body_preview',
      'l.status',
      'l.error_message',
      'l.order_id',
      'l.created_at',
      'l.user_id',
      'u.name as user_name'
    );
  const result = await paginate(qb, {
    ...query,
    sort: query?.sort || '-created_at',
    search_fields: ['l.template_key', 'l.recipient_phone', 'l.status', 'u.name'],
  });
  return result;
}

export async function sendWhatsAppMessage(shopId, userId, body, { beforeDispatch } = {}) {
  const { template_key, phone, context, order_id, document } = body;
  const payload = await getConnectionPayload(shopId);
  if (!payload.can_send) {
    throw badRequest('WhatsApp is not connected. Scan QR code in Settings first.');
  }

  const jid = phoneToJid(phone);
  if (!jid) {
    throw badRequest('Invalid recipient phone number');
  }

  const { body: renderedBody, template: tpl } = await renderTemplateWithOrderContext(
    shopId,
    template_key,
    {
      order_id,
      context,
      strip_bill_pdf_token: !!document || !!body.attach_bill_pdf,
    }
  );

  const wantsPdf =
    !!document ||
    shouldAttachBillPdf({
      message: tpl?.message,
      attach_bill_pdf: body.attach_bill_pdf ?? tpl?.attach_bill_pdf,
      order_id,
    });

  if (wantsPdf && !document) {
    throw badRequest('Bill PDF attachment requires order data from the desktop app.');
  }

  const logId = uuid();
  let preview = renderedBody.slice(0, 500);
  if (document) {
    preview = `${preview}${preview ? ' ' : ''}[+ PDF: ${document.filename || 'bill.pdf'}]`.slice(0, 500);
  }
  const recipientPhone = normalizeWhatsAppRecipient(phone);

  await knex('whatsapp_message_logs').insert({
    id: logId,
    shop_id: shopId,
    user_id: userId,
    template_key,
    recipient_phone: recipientPhone,
    recipient_jid: jid,
    body_preview: preview,
    status: 'queued',
    order_id: order_id || null,
    created_at: knex.fn.now(),
  });

  let providerStarted = false;
  const markDispatch = async () => {
    await beforeDispatch?.({ logId });
    providerStarted = true;
  };
  try {
    if (document) {
      const buffer = Buffer.from(document.content_base64, 'base64');
      if (!buffer.length) {
        throw new Error('Bill PDF is empty');
      }
      await sendDocument(shopId, jid, {
        buffer,
        mimetype: document.mimetype || 'application/pdf',
        fileName: document.filename || 'bill.pdf',
        caption: renderedBody,
        beforeDispatch: markDispatch,
      });
    } else {
      await sendText(shopId, jid, renderedBody, { beforeDispatch: markDispatch });
    }
    await knex('whatsapp_message_logs').where({ id: logId }).update({ status: 'sent' });
    await updateSession(shopId, { last_seen_at: knex.fn.now() }).catch(() => {});
    return { id: logId, status: 'sent', recipient_jid: jid, body_preview: preview };
  } catch (err) {
    const errMsg = err?.message || 'Send failed';
    await knex('whatsapp_message_logs').where({ id: logId }).update({
      status: providerStarted ? 'uncertain' : 'failed',
      error_message: errMsg,
    }).catch(() => {});
    throw badRequest(providerStarted
      ? `WhatsApp delivery acknowledgment is uncertain. Check WhatsApp before resending. (${errMsg})`
      : errMsg);
  }
}

export async function reconnectPersistedSessions() {
  const rows = await knex('whatsapp_shop_sessions').where({ should_reconnect: true }).select('shop_id');
  for (const { shop_id: shopId } of rows) {
    try {
      await logConnectionEvent(shopId, null, 'reconnect', 'Backend restart — reconnecting session').catch(() => {});
      await resumeSession(shopId, sessionHooks(shopId, null));
    } catch (err) {
      await updateSession(shopId, {
        status: 'disconnected',
        last_error: err?.message || 'Reconnect failed',
      }).catch(() => {});
      await logConnectionEvent(shopId, null, 'error', err?.message || 'Reconnect failed').catch(() => {});
    }
  }
}

export { SESSION_STATUSES };
