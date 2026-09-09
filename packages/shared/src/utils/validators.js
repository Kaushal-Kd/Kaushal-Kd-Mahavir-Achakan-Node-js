/**
 * Regex patterns and validators used across both backend schemas and
 * frontend form inputs. Keep this file free of heavy deps so it can be
 * consumed by Node (Fastify) and Vite (React) without transpilation.
 *
 * Phone = 10-digit contact number (any leading digit), optional +91 / 91 prefix
 * Email = standard RFC-ish email
 * GSTIN = 15 chars, GST-of-India format (§ 3.1 of CGST rules)
 * PAN   = 10 chars, `AAAAA9999A`
 * PIN   = 6 digits, first non-zero
 */

export const PHONE_DIGITS_LENGTH = 10;

export const REGEX = Object.freeze({
  PHONE_IN: /^\d{10}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  GSTIN: /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/,
  PAN: /^[A-Z]{5}\d{4}[A-Z]{1}$/,
  PINCODE: /^[1-9]\d{5}$/,
});

/**
 * Strip separators and optional + / India country code.
 * - 12 digits `91` + 10-digit local number → return the 10 digits only.
 * - 10 digits already → return unchanged.
 */
/** Strip non-digits and cap length (default 10-digit contact number). */
export const digitsOnly = (raw, maxLen = PHONE_DIGITS_LENGTH) =>
  String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, maxLen);

/**
 * For controlled phone inputs: digits only, max 10 — no country code in the field.
 * If the user pastes `91XXXXXXXXXX` or `0XXXXXXXXXX`, keep the 10-digit mobile part.
 */
export const phoneInputDigits = (raw) => {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d.slice(0, PHONE_DIGITS_LENGTH);
};

export const normalizePhone = (v) => {
  if (v == null) return '';
  let s = String(v)
    .trim()
    .replace(/[\s\-()]/g, '')
    .replace(/^\+/, '');
  if (!s) return '';
  if (/^91\d{10}$/.test(s)) return s.slice(2);
  if (/^\d{10}$/.test(s)) return s;
  return s.replace(/\D/g, '').slice(0, PHONE_DIGITS_LENGTH);
};

/** @param {unknown} v @returns {boolean} True when value is exactly 10 digits after normalizePhone. */
export const isIndianPhone = (v) => {
  if (v == null || v === '') return false;
  return REGEX.PHONE_IN.test(normalizePhone(v));
};

/**
 * Collect unique valid 10-digit contact numbers from one or more raw values (e.g. booking contacts).
 * @param {...unknown} values
 * @returns {string[]}
 */
export function collectIndianPhones(...values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const p = normalizePhone(v);
    if (!REGEX.PHONE_IN.test(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export const isEmail = (v) => {
  if (v == null || v === '') return false;
  return REGEX.EMAIL.test(String(v).trim());
};

export const isGSTIN = (v) => {
  if (v == null || v === '') return false;
  return REGEX.GSTIN.test(String(v).trim().toUpperCase());
};

export const isPAN = (v) => {
  if (v == null || v === '') return false;
  return REGEX.PAN.test(String(v).trim().toUpperCase());
};

export const isPincode = (v) => {
  if (v == null || v === '') return false;
  return REGEX.PINCODE.test(String(v).trim());
};

/**
 * Run synchronous per-field validation and return a map of {field: message}
 * for any invalid value. Empty / nullish values are considered valid unless
 * `required` is true in the rule.
 *
 * rules = { phone: { type: 'phone', required: true, label: 'Phone' }, ... }
 */
export const validateFields = (values, rules) => {
  const errors = {};
  for (const [key, rule] of Object.entries(rules || {})) {
    const raw = values?.[key];
    const hasValue = raw != null && String(raw).trim() !== '';

    if (rule.required && !hasValue) {
      errors[key] = `${rule.label || key} is required`;
      continue;
    }
    if (!hasValue) continue;

    switch (rule.type) {
      case 'phone':
        if (!isIndianPhone(raw)) errors[key] = 'Enter a valid 10-digit mobile number';
        break;
      case 'email':
        if (!isEmail(raw)) errors[key] = 'Enter a valid email address';
        break;
      case 'gstin':
        if (!isGSTIN(raw)) errors[key] = 'Invalid GSTIN (e.g. 22AAAAA0000A1Z5)';
        break;
      case 'pan':
        if (!isPAN(raw)) errors[key] = 'Invalid PAN (e.g. AAAAA9999A)';
        break;
      case 'pincode':
        if (!isPincode(raw)) errors[key] = 'PIN must be 6 digits';
        break;
      default:
        break;
    }
  }
  return errors;
};
