const STORAGE_KEY = 'wrs.tokenDownloadPrompt';

/**
 * Persist post-create token prompt across navigation (survives Strict Mode remount).
 * @param {object} order
 */
export function stashTokenDownloadPrompt(order) {
  if (!order?.id) return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ orderId: String(order.id), savedOrder: order })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * @param {string} orderId
 * @returns {object|null}
 */
export function readTokenDownloadPrompt(orderId) {
  if (!orderId) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (String(parsed?.orderId || '') !== String(orderId)) return null;
    return parsed?.savedOrder || null;
  } catch {
    return null;
  }
}

export function clearTokenDownloadPrompt() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
