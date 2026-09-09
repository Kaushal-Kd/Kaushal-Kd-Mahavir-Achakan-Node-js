import { formatCurrency } from '@wrs/shared';

const SECURITY_CATEGORIES = new Set(['deposit', 'deposit_refund']);

function normId(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

/** Strip control / formatting chars that often render as missing-glyph boxes in UI fonts. */
function sanitizeLabel(s) {
  return String(s ?? '')
    .replace(/[\p{Cc}\p{Cf}\uFFFC]/gu, '')
    .trim();
}

function buildMap(rows, emptyFallback) {
  const m = new Map();
  for (const a of rows || []) {
    const id = normId(a?.id);
    if (!id) continue;
    const label = sanitizeLabel(a?.name) || emptyFallback;
    m.set(id, label);
  }
  return m;
}

/**
 * When there is exactly one non-deleted security payment on the order, returns a short
 * `Account name → amount` string for display beside the info button. Otherwise `null`.
 *
 * Prefers `payment_account_name` / `security_account_name` from the order API (joined on
 * the server) so labels stay correct when an account is inactive or omitted from list calls.
 *
 * @param {unknown[]|undefined} payments
 * @param {{ paymentAccounts?: Array<{ id: string, name?: string }>, securityAccounts?: Array<{ id: string, name?: string }> }} lookups
 * @returns {string|null}
 */
export function formatSingleSecurityTxInline(payments, { paymentAccounts = [], securityAccounts = [] } = {}) {
  const rows = (Array.isArray(payments) ? payments : []).filter(
    (p) => p && SECURITY_CATEGORIES.has(p.category) && !p.is_deleted
  );
  if (rows.length !== 1) return null;
  const p = rows[0];
  const payMap = buildMap(paymentAccounts, 'Account');
  const secMap = buildMap(securityAccounts, 'Security');

  const payId = normId(p.payment_account_id ?? p.paymentAccountId);
  const secId = normId(p.security_account_id ?? p.securityAccountId);

  let accountLabel = sanitizeLabel(p.payment_account_name);
  if (!accountLabel && payId) accountLabel = payMap.get(payId) || '';
  if (!accountLabel) accountLabel = sanitizeLabel(p.security_account_name);
  if (!accountLabel && secId) accountLabel = secMap.get(secId) || '';
  if (!accountLabel && payId) accountLabel = payId.length > 18 ? `${payId.slice(0, 10)}…` : payId;
  if (!accountLabel && secId) accountLabel = secId.length > 18 ? `${secId.slice(0, 10)}…` : secId;
  if (!accountLabel) {
    const pt = String(p.payment_type || '').trim();
    accountLabel = pt ? pt.charAt(0).toUpperCase() + pt.slice(1).toLowerCase() : '—';
  }

  const raw = Number(p.amount || 0);
  const signed = p.category === 'deposit_refund' ? -Math.abs(raw) : raw;
  return `${accountLabel} → ${formatCurrency(signed)}`;
}
