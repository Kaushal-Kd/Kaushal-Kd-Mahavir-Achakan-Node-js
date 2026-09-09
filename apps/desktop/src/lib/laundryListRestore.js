const LAUNDRY_LIST_RESTORE_KEY = 'wrs.laundryListRestore';

/**
 * @typedef {object} LaundryListRestoreState
 * @property {string} [query]
 * @property {string} [laundryFrom]
 * @property {string} [laundryTo]
 * @property {boolean} [queueModalOpen]
 * @property {string} [queueSearch]
 * @property {string} [queueSort]
 * @property {string|null} [upcomingPopoverQueueItemId]
 * @property {boolean} [upcomingPopoverOpen]
 */

/** @returns {LaundryListRestoreState|null} */
export function readLaundryListRestore() {
  try {
    const raw = sessionStorage.getItem(LAUNDRY_LIST_RESTORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {LaundryListRestoreState} state */
export function writeLaundryListRestore(state) {
  try {
    sessionStorage.setItem(LAUNDRY_LIST_RESTORE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearLaundryListRestore() {
  try {
    sessionStorage.removeItem(LAUNDRY_LIST_RESTORE_KEY);
  } catch {
    /* ignore */
  }
}
