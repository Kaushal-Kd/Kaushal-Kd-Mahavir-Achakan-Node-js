/**
 * Format a number as Indian rupees (requirements §77 localization).
 * @param {number|string|null|undefined} value
 * @param {{ showSymbol?: boolean, decimals?: number }} [options]
 * @returns {string}
 */
export function formatCurrency(value, options = {}) {
  const { showSymbol = true, decimals = 2 } = options;
  const n = Number(value || 0);
  const hasRealDecimals = Math.abs(n - Math.round(n)) >= 0.005;
  const minFrac = hasRealDecimals ? decimals : 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: decimals,
  }).format(n);
  return showSymbol ? `\u20B9${formatted}` : formatted;
}

/**
 * Round to 2 decimals to avoid FP drift.
 * @param {number} n
 * @returns {number}
 */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a user-entered numeric string (handles commas and ₹).
 * @param {string|number|null|undefined} value
 * @returns {number}
 */
export function parseAmount(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
