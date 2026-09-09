/**
 * Image cache service stub (requirements \u00a772 & 95.4).
 *
 * Browser / Electron will use the HTTP disk cache automatically, but this
 * module provides an explicit API we can wire to a per-shop LRU cache
 * on disk (via Electron's userData path) and, later, Service Worker /
 * Electron net.session.defaultSession for offline-first image display.
 */

const memory = new Map();

export const imageCache = {
  /** @param {string} url */
  async get(url) {
    if (!url) return null;
    if (memory.has(url)) return memory.get(url);
    return null;
  },
  /** @param {string} url @param {Blob|string} payload */
  set(url, payload) {
    if (!url) return;
    memory.set(url, payload);
  },
  clear() {
    memory.clear();
  },
};
