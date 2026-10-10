import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { remindersApi } from '../lib/api/reminders.js';
import {
  getBrowserNotificationPermission,
  isBrowserNotificationSupported,
  listRemindersToNotify,
  loadNotifiedKeys,
  persistNotifiedKey,
  reminderDueAtMs,
  reminderOccurrenceKey,
  REMINDER_NOTIFY_CATCHUP_MS,
  REMINDER_NOTIFY_GRACE_MS,
  REMINDER_NOTIFY_PERMISSION_EVENT,
  requestBrowserNotificationPermission,
  showBrowserReminderNotification,
} from '../lib/reminderBrowserNotifications.js';
import { isReminderAssignedToUser } from '../lib/reminderDateTime.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';

const POLL_MS = 30_000;
const SCHEDULE_AHEAD_MS = 2 * 60 * 60 * 1000;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useBrowserNotificationPermission() {
  const [permission, setPermission] = useState(getBrowserNotificationPermission);

  useEffect(() => {
    if (!isBrowserNotificationSupported()) return undefined;
    let status = null;
    let cancelled = false;
    const sync = () => setPermission(getBrowserNotificationPermission());
    sync();
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' })
        .then((result) => {
          if (cancelled) return;
          status = result;
          status.onchange = sync;
        })
        .catch(() => {});
    }
    window.addEventListener(REMINDER_NOTIFY_PERMISSION_EVENT, sync);
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
      window.removeEventListener(REMINDER_NOTIFY_PERMISSION_EVENT, sync);
    };
  }, []);

  const requestPermission = useCallback(async () => {
    const next = await requestBrowserNotificationPermission();
    setPermission(next);
    return next;
  }, []);

  return {
    supported: isBrowserNotificationSupported(),
    permission,
    requestPermission,
  };
}

export function useReminderBrowserNotifications() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const shopId = useShopStore((s) => s.selectedShopId);
  const { permission, supported, requestPermission } = useBrowserNotificationPermission();

  const enabled = Boolean(user?.id && shopId);
  const { data } = useQuery({
    queryKey: ['reminders', shopId],
    queryFn: () => remindersApi.list(),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  const rows = data?.data || [];

  const fireDue = useCallback(
    (graceMs) => {
      if (!user?.id || !shopId) return;
      if (getBrowserNotificationPermission() !== 'granted') return;
      const nowMs = Date.now();
      const store = storage();
      const notifiedKeys = loadNotifiedKeys(store, user.id, shopId, nowMs);
      const due = listRemindersToNotify(rows, { user, nowMs, notifiedKeys, graceMs });
      for (const row of due) {
        const shown = showBrowserReminderNotification(row, {
          onClick: () => navigate('/dashboard'),
        });
        if (shown) persistNotifiedKey(store, user.id, shopId, reminderOccurrenceKey(row), nowMs);
      }
    },
    [navigate, rows, shopId, user]
  );

  useEffect(() => {
    if (!enabled || permission !== 'granted') return undefined;
    fireDue(REMINDER_NOTIFY_GRACE_MS);
    const interval = window.setInterval(() => fireDue(REMINDER_NOTIFY_GRACE_MS), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fireDue(REMINDER_NOTIFY_CATCHUP_MS);
    };
    document.addEventListener('visibilitychange', onVisible);

    const timers = [];
    const now = Date.now();
    for (const row of rows) {
      if (row?.is_completed || !isReminderAssignedToUser(row, user)) continue;
      const dueAt = reminderDueAtMs(row);
      if (dueAt == null) continue;
      const delay = dueAt - now;
      if (delay <= 0 || delay > SCHEDULE_AHEAD_MS) continue;
      timers.push(window.setTimeout(() => fireDue(REMINDER_NOTIFY_GRACE_MS), delay));
    }

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [enabled, fireDue, permission, rows, user]);

  return {
    supported,
    permission,
    requestPermission,
  };
}

export default useReminderBrowserNotifications;
