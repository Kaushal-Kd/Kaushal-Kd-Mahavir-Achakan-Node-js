/**
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
const AXIOS_STATUS_RE = /^Request failed with status code \d+$/i;

export function getApiErrorMessage(err, fallback = 'Something went wrong') {
  const data = err?.response?.data;
  const fromBody = data?.error?.message || data?.message;
  if (fromBody) return String(fromBody);

  const status = err?.response?.status;
  if (status === 403) {
    return 'Your Shop Admin password is incorrect. Please try again.';
  }
  if (status === 401) return 'Your session has expired. Please sign in again.';

  const raw = err?.message;
  if (raw && !AXIOS_STATUS_RE.test(String(raw))) return String(raw);
  return fallback;
}
