/**
 * Desktop form validation helpers.
 *
 * Conventions:
 * 1. Collect all field errors in one object before submit.
 * 2. Call rejectSubmit — sets errors, shows toast, scrolls to first invalid field.
 * 3. Pass error={fieldErrors.key} to Input/Select; fieldShellClass for raw <select>.
 * 4. clearFieldError on change.
 * 5. Prefer validateFields from @wrs/shared for simple rules.
 */

import clsx from 'clsx';

/** @typedef {Record<string, string>} FieldErrorMap */

/**
 * Map Zod issue list to { fieldKey: message } using first path segment.
 * @param {import('zod').ZodIssue[]} issues
 * @returns {FieldErrorMap}
 */
export function zodIssuesToFieldMap(issues) {
  const out = {};
  for (const issue of issues || []) {
    const key = issue.path?.[0];
    if (key == null || key === '') continue;
    const k = String(key);
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}

/**
 * Remove one field key from the errors state (on input change).
 * @param {React.Dispatch<React.SetStateAction<FieldErrorMap>>} setErrors
 * @param {string} key
 */
export function clearFieldError(setErrors, key) {
  setErrors((prev) => {
    if (!prev[key]) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

/**
 * Tailwind classes for raw inputs/selects (not Input/Select components).
 * @param {string | undefined} errorMessage
 * @param {string} [baseClass]
 */
export function fieldShellClass(errorMessage, baseClass = 'input w-full') {
  return clsx(
    baseClass,
    errorMessage && 'border-red-400 focus:border-red-500 focus:ring-red-400 ring-1 ring-red-400'
  );
}

const DEFAULT_SCROLL_ORDER = [];

/**
 * Scroll to the first field with an error, using fieldRefs and optional order.
 * @param {FieldErrorMap} errors
 * @param {Record<string, React.RefObject<HTMLElement | null>>} [fieldRefs]
 * @param {string[]} [order]
 */
export function scrollToFirstFieldError(errors, fieldRefs, order = DEFAULT_SCROLL_ORDER) {
  const keys = Object.keys(errors || {});
  if (!keys.length || !fieldRefs) return;

  const ordered = order.length
    ? [...order.filter((k) => errors[k]), ...keys.filter((k) => !order.includes(k))]
    : keys;

  for (const key of ordered) {
    const el = fieldRefs[key]?.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      break;
    }
  }
}

/**
 * Apply field errors, toast, and scroll. Returns true if submit should abort.
 * @param {{
 *   errors: FieldErrorMap,
 *   setErrors: React.Dispatch<React.SetStateAction<FieldErrorMap>>,
 *   toast: { error: (msg: string) => void },
 *   message?: string,
 *   fieldRefs?: Record<string, React.RefObject<HTMLElement | null>>,
 *   scrollOrder?: string[],
 * }} opts
 * @returns {boolean}
 */
export function rejectSubmit({ errors, setErrors, toast, message, fieldRefs, scrollOrder }) {
  const keys = Object.keys(errors || {});
  if (!keys.length) return false;

  setErrors(errors);
  const firstKey = scrollOrder?.find((k) => errors[k]) || keys[0];
  const toastMsg = message || errors[firstKey] || 'Please fix the highlighted fields';
  toast.error(toastMsg);
  scrollToFirstFieldError(errors, fieldRefs, scrollOrder);
  return true;
}
