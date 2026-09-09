import { useEffect, useRef } from 'react';

import { api, hardLogout } from '../lib/api.js';
import { useAuthStore } from '../stores/authStore.js';
import { toast } from '../stores/uiStore.js';

const DEFAULT_IDLE_MS = 2 * 60 * 60 * 1000;
const WARN_MS = 60 * 1000;

/**
 * Auto-logout after idle timeout (requirements §48).
 */
export function useIdleLogout(idleMs) {
  const timeoutMs = idleMs || DEFAULT_IDLE_MS;
  const lastActivity = useRef(Date.now());
  const warnedRef = useRef(false);

  useEffect(() => {
    const bump = () => {
      lastActivity.current = Date.now();
      warnedRef.current = false;
    };
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const interval = setInterval(() => {
      if (!useAuthStore.getState().accessToken) return;
      const idle = Date.now() - lastActivity.current;
      if (idle >= timeoutMs) {
        api.post('/auth/logout').catch(() => {});
        hardLogout();
        toast.info('You were logged out due to inactivity.');
        return;
      }
      if (!warnedRef.current && idle >= timeoutMs - WARN_MS) {
        warnedRef.current = true;
        toast.warning('You will be logged out in 1 minute due to inactivity.');
      }
    }, 15000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(interval);
    };
  }, [timeoutMs]);
}
