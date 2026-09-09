/** Canonical product code: `{prefix}{number}[size]` e.g. `A-001[38]`. */

/** @param {unknown} value */
export function normalizeProductName(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** @param {unknown} value */
export function normalizeProductCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Full catalog identity: base code plus optional `[size]` suffix.
 * Idempotent when code already includes a bracket suffix.
 * @param {unknown} code
 * @param {unknown} [size]
 */
export function resolveFullProductCode(code, size = '') {
  const normalized = normalizeProductCode(code);
  if (!normalized) return '';
  if (/\[[^\]]+\]$/.test(normalized)) return normalized;
  const sizeStr = String(size ?? '').trim();
  if (!sizeStr) return normalized;
  return normalizeProductCode(`${normalized}[${sizeStr}]`);
}

/**
 * Base code without the trailing `[size]` suffix.
 * `A-0795[40]` -> `A-0795`, `A-0795` -> `A-0795`.
 * @param {unknown} code
 */
export function stripProductCodeSize(code) {
  return normalizeProductCode(code).replace(/\[[^\]]*\]$/, '');
}

/**
 * Digit-normalized key for a product code so `A-0795` and `A-795` match.
 * Strips the size suffix, removes non-alphanumerics, and trims leading zeros
 * from the numeric segment. `A-0795[40]` -> `A795`, `0795` -> `795`.
 * @param {unknown} code
 */
export function productCodeDigitsKey(code) {
  const base = stripProductCodeSize(code).replace(/[^A-Z0-9]/g, '');
  if (!base) return '';
  const match = base.match(/^([A-Z]*)(\d.*)$/);
  if (!match) return base;
  const [, prefix, rest] = match;
  const trimmed = rest.replace(/^0+(?=\d)/, '');
  return `${prefix}${trimmed}`;
}

/**
 * Classify product search input for autocomplete / list filtering.
 * @param {string} term
 * @returns {{ mode: 'none' } | { mode: 'digits', term: string } | { mode: 'prefix', term: string, normalizedPrefix: string } | { mode: 'text', term: string }}
 */
export function classifyProductSearchTerm(term) {
  const t = String(term ?? '').trim();
  if (!t) return { mode: 'none' };

  // Multi-word input is treated as name/text search, not product-code prefix logic.
  if (/\s/.test(t)) {
    return { mode: 'text', term: t };
  }

  if (/^\d+$/.test(t)) {
    return { mode: 'digits', term: t };
  }

  const normalized = normalizeProductCode(t);

  // Partial/full codes like FA-05 or A-0796 — prefix match (same series + number start).
  if (/^[A-Za-z]{1,2}-\d/.test(normalized)) {
    return { mode: 'prefix', term: t, normalizedPrefix: normalized.toLowerCase() };
  }

  const isShortLetterPrefix = /^[A-Za-z]{1,2}$/.test(normalized);
  const isLetterDashPrefix = /^[A-Za-z]{1,2}-/.test(normalized);
  const isLetterDigitCode = /^[A-Za-z]{1,2}-?\d/.test(normalized);
  if (isShortLetterPrefix || isLetterDashPrefix || isLetterDigitCode) {
    return { mode: 'prefix', term: t, normalizedPrefix: normalized.toLowerCase() };
  }

  return { mode: 'text', term: t };
}

function formatSizeSuffix(size) {
  const s = String(size ?? '').trim();
  return s ? `[${s}]` : '';
}

/**
 * @param {string} prefix — from Code format (e.g. `A-`)
 * @param {number} number
 * @param {number} [padding]
 * @param {string} [size]
 */
export function buildProductCode(prefix, number, padding = 4, size = '') {
  const p = String(prefix ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const n = Math.max(0, Math.floor(Number(number) || 0));
  const pad = Math.max(1, Math.min(10, Number(padding) || 4));
  const num = String(n).padStart(pad, '0');
  const sizePart = formatSizeSuffix(size);
  if (!p) return normalizeProductCode(`${num}${sizePart}`);
  return normalizeProductCode(`${p}${num}${sizePart}`);
}

/**
 * @param {string} fullCode
 * @param {string} prefix
 * @param {number} [padding]
 * @returns {{ suffix: string, number: number, size: string } | null}
 */
export function parseProductCode(fullCode, prefix, padding = 4) {
  const code = normalizeProductCode(fullCode);
  const p = String(prefix ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const pad = Math.max(1, Math.min(10, Number(padding) || 4));

  const matchRest = (rest) => {
    const compact = String(rest ?? '').trim().replace(/\s+/g, '').toUpperCase();
    const m = compact.match(/^(\d+)(?:\[([^\]]*)\])?$/);
    if (!m) return null;
    const number = Number.parseInt(m[1], 10);
    if (!Number.isFinite(number)) return null;
    return {
      suffix: String(number).padStart(pad, '0'),
      number,
      size: String(m[2] ?? '').trim(),
    };
  };

  if (!code) return null;
  if (!p) return matchRest(code);
  if (!code.startsWith(p)) return null;
  return matchRest(code.slice(p.length));
}

/** @deprecated Use parseProductCode — kept for existing imports. */
export function parseProductCodeSuffix(fullCode, prefix, padding = 4) {
  const parsed = parseProductCode(fullCode, prefix, padding);
  if (!parsed) return null;
  return { suffix: parsed.suffix, number: parsed.number };
}

/**
 * @param {object|null|undefined} format
 * @param {string|null|undefined} categoryId
 */
export function resolveProductCodePrefixFromFormat(format, categoryId) {
  if (!format) return '';
  if (categoryId && format.by_category?.[categoryId]) {
    return format.by_category[categoryId];
  }
  return format.default_prefix || format.prefix || '';
}

/** Strip non-digits and cap length for numeric suffix input. */
export function sanitizeCodeSuffixInput(value, padding = 4) {
  const pad = Math.max(1, Math.min(10, Number(padding) || 4));
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, pad);
}

/**
 * Extract numeric sequence from stored codes for next-code generation.
 * Ignores trailing size suffixes such as `[L]` or `[38]`.
 * @param {string} code
 * @param {string} prefix
 * @param {number} [padding]
 */
export function productCodeNumberFromStored(code, prefix, padding = 4) {
  const parsed = parseProductCode(code, prefix, padding);
  if (parsed?.number != null) return parsed.number;

  const normalized = normalizeProductCode(code);
  const p = String(prefix ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!normalized) return 0;
  if (p && !normalized.startsWith(p)) return 0;

  const rest = p ? normalized.slice(p.length) : normalized;
  const withoutSize = rest.replace(/\[([^\]]*)\]$/, '');
  const match = withoutSize.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * Whether `targetNumber` is already used on a code with the same prefix.
 * When `options.size` is provided (including empty string), only the same
 * number + size combination conflicts — so `A-668[36]` and `A-668[38]` can both exist.
 * When `size` is omitted, any code with that number conflicts (used for next-number sequencing).
 * @param {string[]} codes
 * @param {string} prefix
 * @param {number} [padding]
 * @param {number} targetNumber
 * @param {{ excludeCode?: string, size?: string }} [options]
 * @returns {{ number: number, existingCode: string } | null}
 */
export function findProductCodeNumberConflict(codes, prefix, padding, targetNumber, options = {}) {
  const num = Math.floor(Number(targetNumber));
  if (!Number.isFinite(num) || num <= 0) return null;
  const p = String(prefix ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!p) return null;
  const pad = Math.max(1, Math.min(10, Number(padding) || 4));
  const excludeCode = options.excludeCode ? normalizeProductCode(options.excludeCode) : '';
  const sizeFilter =
    options.size !== undefined && options.size !== null
      ? String(options.size).trim().toUpperCase()
      : null;

  for (const raw of codes || []) {
    const code = normalizeProductCode(raw);
    if (!code) continue;
    if (excludeCode && code === excludeCode) continue;
    const parsed = parseProductCode(code, p, pad);
    const stored = parsed?.number ?? productCodeNumberFromStored(code, p, pad);
    if (stored !== num) continue;
    if (sizeFilter !== null) {
      const codeSize = String(parsed?.size ?? '').trim().toUpperCase();
      if (codeSize !== sizeFilter) continue;
    }
    return { number: num, existingCode: code };
  }
  return null;
}
