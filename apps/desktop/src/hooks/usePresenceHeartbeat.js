import { useEffect } from 'react';

import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/authStore.js';

/**
 * Interval must stay in step with WRITE_INTERVAL_MS in
 * apps/backend/src/lib/presence.js — the server throttles presence writes to one
 * per user per minute, so pinging faster costs requests without moving the dot,
 * and pinging slower lets ONLINE_WINDOW_MS (2 min) expire between beats.
 */
const HEARTBEAT_MS = 60 * 1000;

/**
 * Keep this user's presence fresh for as long as the app is open.
 *
 * Without it, `last_seen_at` only moves when the user actually does something,
 * so somebody sitting idle at the counter with the app open goes offline after
 * two minutes. The ping carries no payload — the server stamps presence in its
 * global auth preHandler, so simply making an authenticated request is the
 * whole mechanism.
 *
 * This is not a keep-alive: `useIdleLogout` measures real user input, not
 * requests, so a heartbeat cannot hold a dead session open.
 */
export function usePresenceHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (!useAuthStore.getState().accessToken) return;
      api
        .get('/auth/ping')
        .then((response) => {
          const restricted = response.data?.data?.ip_access_restricted;
          if (typeof restricted === 'boolean') {
            useAuthStore.getState().setIpAccessState(restricted, false);
          }
        })
        .catch(() => {});
    };

    // A window that was minimised or backgrounded may have missed several
    // beats, so beat immediately on the way back rather than showing offline
    // for up to another minute.
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };

    ping();
    const interval = setInterval(ping, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

export default usePresenceHeartbeat;
