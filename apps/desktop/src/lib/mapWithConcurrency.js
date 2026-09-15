/**
 * Run async work over a list with a max number of in-flight tasks.
 * Prevents booking/availability pages from opening 20+ API calls at once and
 * exhausting the backend DB pool (which made the app hang / not load).
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const cap = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const out = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      out[index] = await fn(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return out;
}
