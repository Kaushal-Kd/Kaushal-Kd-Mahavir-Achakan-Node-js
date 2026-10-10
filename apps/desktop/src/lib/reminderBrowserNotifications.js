import {
  formatReminderDateTime,
  isReminderAssignedToUser,
  reminderDueAtMs,
  reminderSortKey,
} from './reminderDateTime.js';

export const REMINDER_NOTIFY_STORAGE_KEY = 'wrs.reminderBrowserNotified.v1';
export const REMINDER_NOTIFY_PERMISSION_EVENT = 'wrs-notification-permission';
/** Fire if the due instant is up to this late (covers background-tab timer throttling). */
export const REMINDER_NOTIFY_GRACE_MS = 10 * 60 * 1000;
/** When the tab becomes visible again, catch reminders missed while hidden. */
export const REMINDER_NOTIFY_CATCHUP_MS = 60 * 60 * 1000;
const STORE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function isBrowserNotificationSupported() {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}

export function getBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return window.Notification.permission || 'default';
}

function emitPermissionChange() {
  try {
    window.dispatchEvent(new Event(REMINDER_NOTIFY_PERMISSION_EVENT));
  } catch {
    /* ignore */
  }
}

export async function requestBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  if (window.Notification.permission === 'granted') {
    emitPermissionChange();
    return 'granted';
  }
  if (window.Notification.permission === 'denied') return 'denied';
  try {
    const result = await window.Notification.requestPermission();
    emitPermissionChange();
    return result || getBrowserNotificationPermission();
  } catch {
    return getBrowserNotificationPermission();
  }
}

export function reminderOccurrenceKey(row) {
  const id = String(row?.id || '').trim();
  const due = reminderSortKey(row);
  if (!id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)) return '';
  return `${id}::${due}`;
}

export function notifiedStoreScope(userId, shopId) {
  const user = String(userId || '').trim();
  const shop = String(shopId || '').trim();
  if (!user || !shop) return '';
  return `${user}::${shop}`;
}

function readRawStore(storage) {
  try {
    const raw = storage?.getItem?.(REMINDER_NOTIFY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadNotifiedKeys(storage, userId, shopId, nowMs = Date.now()) {
  const scope = notifiedStoreScope(userId, shopId);
  const all = readRawStore(storage);
  const bucket = scope && all[scope] && typeof all[scope] === 'object' ? all[scope] : {};
  const keys = new Set();
  for (const [key, shownAt] of Object.entries(bucket)) {
    if (nowMs - Number(shownAt || 0) > STORE_TTL_MS) continue;
    keys.add(key);
  }
  return keys;
}

export function persistNotifiedKey(storage, userId, shopId, occurrenceKey, nowMs = Date.now()) {
  const scope = notifiedStoreScope(userId, shopId);
  if (!scope || !occurrenceKey || !storage?.setItem) return;
  const all = readRawStore(storage);
  const bucket = all[scope] && typeof all[scope] === 'object' ? { ...all[scope] } : {};
  bucket[occurrenceKey] = nowMs;
  for (const [key, shownAt] of Object.entries(bucket)) {
    if (nowMs - Number(shownAt || 0) > STORE_TTL_MS) delete bucket[key];
  }
  try {
    storage.setItem(REMINDER_NOTIFY_STORAGE_KEY, JSON.stringify({ ...all, [scope]: bucket }));
  } catch {
    /* quota / private mode */
  }
}

/**
 * @param {object} row
 * @param {{ nowMs: number, notifiedKeys: Set<string>, graceMs?: number }} opts
 */
export function shouldFireReminderNotification(row, { nowMs, notifiedKeys, graceMs = REMINDER_NOTIFY_GRACE_MS }) {
  if (row?.is_completed) return false;
  if (!String(row?.reminder_date || '').trim() || !String(row?.reminder_time || '').trim()) return false;
  const dueAt = reminderDueAtMs(row);
  if (dueAt == null) return false;
  if (dueAt > nowMs) return false;
  if (nowMs - dueAt > graceMs) return false;
  const key = reminderOccurrenceKey(row);
  if (!key || notifiedKeys?.has(key)) return false;
  return true;
}

export function listRemindersToNotify(
  rows,
  { user, nowMs, notifiedKeys, graceMs = REMINDER_NOTIFY_GRACE_MS }
) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    if (!isReminderAssignedToUser(row, user)) return false;
    return shouldFireReminderNotification(row, { nowMs, notifiedKeys, graceMs });
  });
}

export function reminderNotificationBody(row) {
  const description = String(row?.description || '').trim() || 'Reminder';
  const when = formatReminderDateTime(row?.reminder_date, row?.reminder_time);
  const clipped = description.length > 180 ? `${description.slice(0, 177)}…` : description;
  return when && when !== '—' ? `${clipped}\n${when}` : clipped;
}

export function showBrowserReminderNotification(row, { NotificationImpl, onClick } = {}) {
  const Ctor = NotificationImpl || (typeof window !== 'undefined' ? window.Notification : null);
  if (typeof Ctor !== 'function') return false;
  if (typeof Ctor.permission === 'string' && Ctor.permission !== 'granted') return false;
  const tag = reminderOccurrenceKey(row) || undefined;
  const notification = new Ctor('Achakan reminder', {
    body: reminderNotificationBody(row),
    tag,
    requireInteraction: true,
  });
  if (onClick && notification && typeof notification === 'object') {
    notification.onclick = () => {
      try {
        window.focus?.();
      } catch {
        /* ignore */
      }
      onClick(row);
      notification.close?.();
    };
  }
  return true;
}
