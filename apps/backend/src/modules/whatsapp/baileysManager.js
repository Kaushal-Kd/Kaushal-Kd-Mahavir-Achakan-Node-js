import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { env } from '../../config/env.js';

import {
  connectSessionSocket,
  createScopedSessionOperations,
  deactivateSessionRuntime,
  drainSessionPersistence,
  queueRuntimeSessionHook,
  queueSessionCredentialsSave,
} from './sessionLifecycle.js';

/** @typedef {'disconnected' | 'qr_pending' | 'reconnecting' | 'connected'} SessionStatus */

/** @typedef {object} SessionRuntime
 * @property {import('@innovatorssoft/baileys').WASocket | null} sock
 * @property {string | null} qrDataUrl
 * @property {SessionStatus} status
 * @property {number} reconnectAttempts
 * @property {string} [phoneNumber]
 * @property {string} [waJid]
 * @property {string} [displayName]
 */

/** @type {Map<string, SessionRuntime>} */
const sessions = new Map();

/** @type {Map<string, SessionHooks>} */
const shopHooks = new Map();

/** @type {Set<string>} */
const startingShops = new Set();

/** @type {Set<string>} */
const stopIntent = new Set();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const reconnectTimers = new Map();
const runSocketOperation = createScopedSessionOperations();

const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 5 * 60 * 1000;

export async function invokeSessionHook(hook, ...args) {
  try {
    await hook?.(...args);
    return true;
  } catch {
    // A temporary database/logging failure must not terminate socket recovery.
    return false;
  }
}

export function reconnectDelay(attempt, randomValue = Math.random()) {
  const normalizedAttempt = Math.max(0, Number(attempt) || 0);
  const capped = Math.min(
    MAX_RECONNECT_DELAY_MS,
    BASE_RECONNECT_DELAY_MS * 2 ** Math.min(normalizedAttempt, 8)
  );
  const jitter = Math.min(1, Math.max(0, Number(randomValue) || 0));
  return Math.min(MAX_RECONNECT_DELAY_MS, Math.round(capped * (0.8 + jitter * 0.4)));
}

function clearReconnectTimer(shopId) {
  const timer = reconnectTimers.get(shopId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(shopId);
}

function scheduleReconnect(shopId, hooks, attempt, immediate = false) {
  if (stopIntent.has(shopId)) return;
  const runtime = sessions.get(shopId) || {
    sock: null,
    qrDataUrl: null,
    status: 'reconnecting',
    reconnectAttempts: 0,
  };
  runtime.status = 'reconnecting';
  runtime.reconnectAttempts = Math.max(Number(runtime.reconnectAttempts || 0), Number(attempt || 1));
  sessions.set(shopId, runtime);
  const delay = immediate ? 0 : reconnectDelay(runtime.reconnectAttempts);
  void queueRuntimeSessionHook(
    runtime,
    hooks.onReconnecting,
    () => !stopIntent.has(shopId) && sessions.get(shopId) === runtime,
    immediate
      ? 'Finishing WhatsApp connection…'
      : `Reconnecting after temporary disconnect (attempt ${runtime.reconnectAttempts})…`,
    {
      attempt: runtime.reconnectAttempts,
      next_reconnect_at: new Date(Date.now() + delay),
    }
  );
  clearReconnectTimer(shopId);
  const timer = setTimeout(async () => {
    reconnectTimers.delete(shopId);
    if (stopIntent.has(shopId)) return;
    try {
      await runSocketOperation(shopId, () =>
        openSocket(shopId, shopHooks.get(shopId) || hooks, { isReconnect: true }));
    } catch (error) {
      const activeHooks = shopHooks.get(shopId) || hooks;
      await invokeSessionHook(activeHooks.onError, error?.message || 'Reconnect failed');
      scheduleReconnect(shopId, activeHooks, runtime.reconnectAttempts + 1);
    }
  }, delay);
  reconnectTimers.set(shopId, timer);
}

/** @type {Promise<{ makeWASocket: Function, useMultiFileAuthState: Function, DisconnectReason: Record<string, number>, QRCode: { toDataURL: (s: string) => Promise<string> } }> | null} */
let baileysLib = null;

/**
 * @typedef {object} SessionHooks
 * @property {(qrDataUrl: string) => Promise<void> | void} [onQr]
 * @property {(info: { phone_number: string, wa_jid: string, display_name: string }) => Promise<void> | void} [onConnected]
 * @property {(reason: string, meta?: { kind?: string }) => Promise<void> | void} [onDisconnected]
 * @property {(message: string) => Promise<void> | void} [onError]
 * @property {(message: string, meta?: { attempt?: number, next_reconnect_at?: Date }) => Promise<void> | void} [onReconnecting]
 */

function resolveBaileysExport(mod, name) {
  const named = mod[name];
  if (typeof named === 'function') return named;
  const fromDefault = mod.default?.[name];
  if (typeof fromDefault === 'function') return fromDefault;
  if (typeof mod.default === 'function' && name === 'makeWASocket') return mod.default;
  return null;
}

async function getBaileysLib() {
  if (!baileysLib) {
    const QRCode = (await import('qrcode')).default;
    const mod = await import('@innovatorssoft/baileys');
    const makeWASocket = resolveBaileysExport(mod, 'makeWASocket');
    const useMultiFileAuthState = resolveBaileysExport(mod, 'useMultiFileAuthState');
    if (!makeWASocket || !useMultiFileAuthState) {
      throw new Error('Failed to load @innovatorssoft/baileys exports');
    }
    baileysLib = Promise.resolve({
      makeWASocket,
      useMultiFileAuthState,
      DisconnectReason: mod.DisconnectReason || mod.default?.DisconnectReason,
      QRCode,
    });
  }
  return baileysLib;
}

function authDirForShop(shopId) {
  return join(env.WHATSAPP_AUTH_DIR, shopId);
}

function endSocket(sock) {
  if (!sock) return;
  try {
    sock.end(undefined);
  } catch {
    /* ignore */
  }
}

export function shouldReconnectAfterDisconnect(statusCode, loggedOutStatusCode) {
  return loggedOutStatusCode == null || statusCode !== loggedOutStatusCode;
}

/**
 * @param {string} shopId
 * @param {SessionHooks} hooks
 * @param {{ isReconnect?: boolean }} [opts]
 */
async function openSocket(shopId, hooks, opts = {}) {
  if (startingShops.has(shopId)) {
    return sessions.get(shopId);
  }
  if (stopIntent.has(shopId)) {
    return null;
  }

  startingShops.add(shopId);
  shopHooks.set(shopId, hooks);

  try {
    const {
      makeWASocket,
      useMultiFileAuthState: loadMultiFileAuthState,
      DisconnectReason,
      QRCode,
    } = await getBaileysLib();
    const authDir = authDirForShop(shopId);
    await mkdir(authDir, { recursive: true });

    const prev = sessions.get(shopId);
    if (prev?.sock) {
      const previousSocket = prev.sock;
      prev.sock = null;
      endSocket(previousSocket);
    }
    await drainSessionPersistence(prev);
    if (stopIntent.has(shopId)) return null;

    const { state, saveCreds } = await loadMultiFileAuthState(authDir);
    if (stopIntent.has(shopId)) return null;

    /** @type {SessionRuntime} */
    const runtime = {
      sock: null,
      qrDataUrl: prev?.qrDataUrl ?? null,
      status: opts.isReconnect ? 'reconnecting' : 'qr_pending',
      reconnectAttempts: opts.isReconnect ? (prev?.reconnectAttempts ?? 0) : 0,
      phoneNumber: prev?.phoneNumber,
      waJid: prev?.waJid,
      displayName: prev?.displayName,
    };
    sessions.set(shopId, runtime);

    const isCurrentRuntime = () => !stopIntent.has(shopId) && sessions.get(shopId) === runtime;
    const sock = await connectSessionSocket(runtime, makeWASocket, {
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      fireInitQueries: false,
      shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      browser: ['Windows', 'Chrome', '120'],
    }, {
      beforeConnect: opts.isReconnect
        ? () => queueRuntimeSessionHook(runtime, hooks.onReconnecting,
          isCurrentRuntime, 'Finishing WhatsApp connection…')
        : undefined,
      isCurrent: isCurrentRuntime,
    });
    if (!sock) return null;

    sock.ev.on('creds.update', () => {
      if (!isCurrentRuntime() || runtime.sock !== sock) return;
      return queueSessionCredentialsSave(
        runtime,
        saveCreds,
        isCurrentRuntime,
        () => invokeSessionHook(hooks.onError, 'WhatsApp credentials could not be saved; check server storage')
      );
    });

    sock.ev.on('connection.update', async (update) => {
      if (stopIntent.has(shopId) || sessions.get(shopId) !== runtime || runtime.sock !== sock) return;

      const { connection, lastDisconnect, qr } = update;
      const activeHooks = shopHooks.get(shopId) || hooks;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
          if (stopIntent.has(shopId) || sessions.get(shopId) !== runtime || runtime.sock !== sock) return;
          runtime.qrDataUrl = qrDataUrl;
          runtime.status = 'qr_pending';
          await queueRuntimeSessionHook(runtime, activeHooks.onQr, isCurrentRuntime, qrDataUrl);
        } catch (err) {
          await invokeSessionHook(activeHooks.onError, err?.message || 'Failed to generate QR image');
        }
      }

      if (connection === 'open') {
        clearReconnectTimer(shopId);
        runtime.reconnectAttempts = 0;
        runtime.status = 'connected';
        runtime.qrDataUrl = null;
        const me = sock.user;
        const waJid = me?.id || '';
        const phone = waJid.split('@')[0]?.split(':')[0] || '';
        const displayName = me?.name || me?.verifiedName || '';
        runtime.phoneNumber = phone;
        runtime.waJid = waJid;
        runtime.displayName = displayName;
        await queueRuntimeSessionHook(runtime, activeHooks.onConnected, isCurrentRuntime, {
          phone_number: phone,
          wa_jid: waJid,
          display_name: displayName,
        });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason =
          lastDisconnect?.error?.message ||
          `Connection closed (${statusCode ?? 'unknown'})`;

        if (stopIntent.has(shopId)) {
          sessions.delete(shopId);
          return;
        }

        const loggedOut = !shouldReconnectAfterDisconnect(
          statusCode,
          DisconnectReason.loggedOut
        );

        if (loggedOut) {
          deactivateSessionRuntime(runtime);
          stopIntent.add(shopId);
          clearReconnectTimer(shopId);
          await runSocketOperation(shopId, async () => {
            await drainSessionPersistence(runtime);
            if (sessions.get(shopId) !== runtime) return;
            sessions.delete(shopId);
            try {
              await rm(authDirForShop(shopId), { recursive: true, force: true });
            } catch {
              /* ignore */
            }
            await invokeSessionHook(activeHooks.onDisconnected, reason, { kind: 'provider_logout' });
          });
          return;
        }

        const isRestartRequired = statusCode === DisconnectReason.restartRequired;
        if (!isRestartRequired) runtime.reconnectAttempts += 1;
        runtime.status = 'reconnecting';
        runtime.qrDataUrl = null;
        runtime.sock = null;
        endSocket(sock);
        scheduleReconnect(
          shopId,
          activeHooks,
          Math.max(1, runtime.reconnectAttempts),
          isRestartRequired
        );
      }
    });

    return runtime;
  } finally {
    startingShops.delete(shopId);
  }
}

export function getRuntimeSession(shopId) {
  return sessions.get(shopId) || null;
}

export function hasActiveRuntime(shopId) {
  const r = sessions.get(shopId);
  if (!r) return false;
  return r.status === 'connected' || r.status === 'qr_pending' || r.status === 'reconnecting';
}

export function getCachedQrDataUrl(shopId) {
  return sessions.get(shopId)?.qrDataUrl ?? null;
}

/**
 * @param {string} shopId
 * @param {SessionHooks} hooks
 */
export async function startSession(shopId, hooks = {}) {
  return runSocketOperation(shopId, () => {
    stopIntent.delete(shopId);
    clearReconnectTimer(shopId);
    return openSocket(shopId, hooks, { isReconnect: false });
  });
}

export async function resumeSession(shopId, hooks = {}) {
  return runSocketOperation(shopId, async () => {
    if (stopIntent.has(shopId)) return null;
    clearReconnectTimer(shopId);
    try {
      return await openSocket(shopId, hooks, { isReconnect: true });
    } catch (error) {
      await invokeSessionHook(hooks.onError, error?.message || 'Reconnect failed');
      scheduleReconnect(shopId, hooks, 1);
      return sessions.get(shopId) || null;
    }
  });
}

export async function stopSession(shopId, { clearAuth = false } = {}) {
  stopIntent.add(shopId);
  clearReconnectTimer(shopId);
  const requestedRuntime = sessions.get(shopId);
  const requestedSocket = deactivateSessionRuntime(requestedRuntime);
  return runSocketOperation(shopId, async () => {
    stopIntent.add(shopId);
    clearReconnectTimer(shopId);
    const runtime = sessions.get(shopId);
    const sock = deactivateSessionRuntime(runtime);
    for (const socket of new Set([sock, requestedSocket].filter(Boolean))) {
      try {
        await socket.logout();
      } catch {
        endSocket(socket);
      }
    }
    await Promise.all([drainSessionPersistence(runtime), drainSessionPersistence(requestedRuntime)]);
    sessions.delete(shopId);
    shopHooks.delete(shopId);

    if (clearAuth) {
      const authDir = authDirForShop(shopId);
      try {
        await rm(authDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * @param {string} shopId
 * @param {string} jid
 * @param {string} text
 */
export async function dispatchSessionMessage(runtime, jid, content, beforeDispatch, isCurrent = () => true) {
  if (!runtime?.sock || runtime.status !== 'connected') {
    throw new Error('WhatsApp is not connected for this shop');
  }
  const sock = runtime.sock;
  await beforeDispatch?.();
  if (runtime.sock !== sock || runtime.status !== 'connected' || !isCurrent()) {
    throw new Error('WhatsApp is not connected for this shop; the session changed before sending');
  }
  return sock.sendMessage(jid, content);
}

export async function sendText(shopId, jid, text, { beforeDispatch } = {}) {
  const runtime = sessions.get(shopId);
  return dispatchSessionMessage(runtime, jid, { text }, beforeDispatch,
    () => !stopIntent.has(shopId) && sessions.get(shopId) === runtime);
}

/**
 * @param {string} shopId
 * @param {string} jid
 * @param {{ buffer: Buffer, mimetype?: string, fileName: string, caption?: string, beforeDispatch?: () => Promise<void> }} opts
 */
export async function sendDocument(shopId, jid, opts) {
  const caption = opts.caption != null ? String(opts.caption) : undefined;
  const runtime = sessions.get(shopId);
  return dispatchSessionMessage(runtime, jid, {
    document: opts.buffer,
    mimetype: opts.mimetype || 'application/pdf',
    fileName: opts.fileName,
    ...(caption !== undefined && caption !== '' ? { caption } : {}),
  }, opts.beforeDispatch, () => !stopIntent.has(shopId) && sessions.get(shopId) === runtime);
}

export async function reconnectConnectedShops(getShops, hooksFactory) {
  const shopIds = await getShops();
  for (const shopId of shopIds) {
    if (startingShops.has(shopId) || hasActiveRuntime(shopId)) continue;
    try {
      await resumeSession(shopId, hooksFactory(shopId));
    } catch (err) {
      console.warn(`[whatsapp] reconnect failed for shop ${shopId}:`, err?.message || err);
    }
  }
}
