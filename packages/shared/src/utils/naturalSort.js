const NATURAL_NUMBER_WIDTH = 20;

/**
 * Build a stable, case-insensitive key whose digit runs compare numerically.
 * The original value remains the final database tie-breaker.
 */
export function naturalSortKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .trim()
    .toLocaleLowerCase('en-IN')
    .replace(/\d+/g, (digits) => {
      const normalized = digits.replace(/^0+(?=\d)/, '');
      return normalized.padStart(NATURAL_NUMBER_WIDTH, '0');
    });
}
