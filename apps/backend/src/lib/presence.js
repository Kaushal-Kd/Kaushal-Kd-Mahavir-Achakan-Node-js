/**
 * Lightweight online/offline presence.
 *
 * There is no websocket here. Presence is derived from API traffic: every
 * authenticated request stamps `users.last_seen_at`, and the users list treats
 * anyone seen inside ONLINE_WINDOW_MS as online.
 *
 * On its own that only measures "clicked something recently", which would grey
 * out a user sitting idle with the app open. The desktop client therefore pings
 * `GET /api/auth/ping` on a timer while it is running (see
 * `apps/desktop/src/hooks/usePresenceHeartbeat.js`), so the signal means "the
 * app is open". That endpoint needs no presence code of its own — it goes
 * through the same global preHandler as everything else.
 *
 * Three numbers have to move together:
 *   WRITE_INTERVAL_MS   how often a user can produce an UPDATE (also the auth
 *                       cache TTL in authCache.js)
 *   heartbeat interval  how often the client pings — matches WRITE_INTERVAL_MS
 *   ONLINE_WINDOW_MS    how stale last_seen_at may be — two intervals, so one
 *                       missed beat does not flip a user offline
 */

const WRITE_INTERVAL_MS = 60_000;

/** How recently a user must have been seen to count as online. */
export const ONLINE_WINDOW_MS = 2 * 60_000;

/** Guard against unbounded growth if a deployment sees very many users. */
const MAX_TRACKED_USERS = 5_000;

/** @type {Map<string, number>} userId -> epoch ms of last write */
const lastWriteAt = new Map();

/** Log a presence write failure once rather than on every request. */
let warnedOnce = false;

/**
 * Record that a user is active. Fire-and-forget: a failure here must never
 * break the request that triggered it.
 *
 * @param {import('knex').Knex} db
 * @param {string} userId
 */
export function touchUserPresence(db, userId) {
  if (!userId) return;
  const id = String(userId);
  const now = Date.now();

  const previous = lastWriteAt.get(id) || 0;
  if (now - previous < WRITE_INTERVAL_MS) return;

  if (lastWriteAt.size >= MAX_TRACKED_USERS) {
    for (const [key, at] of lastWriteAt) {
      if (now - at > WRITE_INTERVAL_MS) lastWriteAt.delete(key);
    }
  }
  lastWriteAt.set(id, now);

  db('users')
    .where({ id })
    .update({ last_seen_at: db.fn.now() })
    .catch((err) => {
      // Keep the throttle stamp. Clearing it would turn a persistent failure
      // (most likely the column missing because this shipped ahead of its
      // migration) into a failing UPDATE on every single request.
      if (!warnedOnce) {
        warnedOnce = true;
        // eslint-disable-next-line no-console
        console.warn('[presence] last_seen_at update failed; presence disabled:', err?.message);
      }
    });
}

/**
 * @param {Date|string|null|undefined} lastSeenAt
 * @returns {boolean}
 */
export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return false;
  return Date.now() - seen < ONLINE_WINDOW_MS;
}
