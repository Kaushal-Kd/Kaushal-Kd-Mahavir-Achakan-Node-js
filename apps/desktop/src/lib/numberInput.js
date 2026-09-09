/**
 * Helpers for amount/qty/percent fields — never persist negative values.
 */

/**
 * @param {string|number|null|undefined} value
 * @param {{ min?: number, empty?: string|number|null, keepEmpty?: boolean }} [opts]
 */
export function parseNonNegativeNumber(value, opts = {}) {
  const min = opts.min ?? 0;
  const empty = opts.empty !== undefined ? opts.empty : '';
  if (value === '' || value == null) {
    return opts.keepEmpty !== false ? empty : min;
  }
  const n = Number(value);
  if (Number.isNaN(n)) return opts.keepEmpty !== false ? empty : min;
  return Math.max(min, n);
}

/** Apply min when field is left empty on blur (after user finished editing). */
export function finalizeNonNegativeNumber(value, opts = {}) {
  const min = opts.min ?? 0;
  if (value === '' || value == null || Number.isNaN(Number(value))) return min;
  return Math.max(min, Number(value));
}

/** Block minus / scientific notation in number fields. */
export function blockNegativeNumberKeys(e) {
  if (e.key === '-' || e.key === 'e' || e.key === 'E') {
    e.preventDefault();
  }
}

/**
 * Wrap onChange — allow empty while typing; only clamp numeric values below min.
 * @param {(e: import('react').ChangeEvent<HTMLInputElement>) => void} handler
 * @param {{ min?: number }} [opts]
 */
export function nonNegativeChange(handler, opts = {}) {
  const min = opts.min ?? 0;
  return (e) => {
    const raw = e.target.value;
    if (raw !== '' && raw != null) {
      const n = Number(raw);
      if (!Number.isNaN(n) && n < min) {
        e.target.value = String(min);
      }
    }
    handler(e);
  };
}
