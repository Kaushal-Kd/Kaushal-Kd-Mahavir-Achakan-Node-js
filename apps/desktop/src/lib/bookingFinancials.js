import { round2 } from '@wrs/shared';

/** @param {unknown} value */
export function toNonNegativeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
}

/** Controlled money input: empty allowed while typing; minus values clamped to 0. */
export function parseAmountInput(raw) {
  if (raw === '' || raw == null) return '';
  return toNonNegativeAmount(raw);
}

/** @param {unknown} raw */
export function parseAmountOrZero(raw) {
  if (raw === '' || raw == null) return 0;
  return toNonNegativeAmount(raw);
}

/** @param {unknown} g */
export function normPaymentAccountGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

/** @param {object[]} paymentAccounts */
export function splitPaymentAccounts(paymentAccounts) {
  const rows = Array.isArray(paymentAccounts) ? paymentAccounts : [];
  return {
    bank: rows.filter((a) => normPaymentAccountGroup(a.account_group) === 'bank accounts'),
    cash: rows.filter((a) => normPaymentAccountGroup(a.account_group) === 'cash accounts'),
  };
}

/** @param {object[]} securityAccounts */
export function mapSecurityAccountOptions(securityAccounts) {
  return (Array.isArray(securityAccounts) ? securityAccounts : []).map((a) => ({
    value: a.id,
    label: a.name,
  }));
}

/** @param {import('react').FocusEvent<HTMLInputElement>} e */
export function selectAmountOnFocus(e) {
  const value = String(e?.target?.value ?? '').trim();
  if (value === '0' || value === '0.0' || value === '0.00') {
    e.target.select();
  }
}

/**
 * Advance/security amounts require a selected account when accounts exist.
 * @param {object} params
 * @param {unknown} params.advanceAmount
 * @param {unknown} params.advanceAccountId
 * @param {unknown} params.depositAmount
 * @param {unknown} params.securityAccountId
 * @param {number} [params.paymentAccountCount]
 * @param {number} [params.securityAccountCount]
 * @param {boolean} [params.requireSecurityAccount]
 * @returns {Record<string, string>}
 */
export function validatePaymentAccountSelection({
  advanceAmount,
  advanceAccountId,
  depositAmount,
  securityAccountId,
  paymentAccountCount = 0,
  securityAccountCount = 0,
  requireSecurityAccount = true,
}) {
  /** @type {Record<string, string>} */
  const errors = {};
  const advAmt = toNonNegativeAmount(advanceAmount);
  const depositAmt = toNonNegativeAmount(depositAmount);
  const advAcc = String(advanceAccountId || '').trim();
  const secAcc = String(securityAccountId || '').trim();

  if (advAmt > 0 && paymentAccountCount > 0 && !advAcc) {
    errors.advance_account_id = 'Select an advance payment account for the amount entered';
  }
  if (
    requireSecurityAccount &&
    depositAmt > 0 &&
    securityAccountCount > 0 &&
    !secAcc
  ) {
    errors.security_account_id = 'Select a security account for the amount entered';
  }
  return errors;
}

/**
 * Raw number inputs (no Input wrapper): empty on blur becomes 0 in parent state.
 * @param {import('react').FocusEvent<HTMLInputElement>} e
 * @param {(value: number) => void} setAmount
 */
export function finalizeAmountOnBlur(e, setAmount) {
  const raw = e?.target?.value;
  if (raw === '' || raw == null) {
    setAmount(0);
  }
}

/** Hide native number spinners; keep 0 visible until the user types. */
export const AMOUNT_INPUT_CLASS =
  'amount-input-no-spinner tabular-nums text-right border border-gray-200 rounded';

/**
 * @param {object} params
 * @param {number} params.advanceAmount
 * @param {number} params.applyCreditAmount
 * @param {number} params.deposit
 * @param {boolean} params.paidSecurityAmt
 */
export function computePaidAtBooking({ advanceAmount, applyCreditAmount, deposit, paidSecurityAmt }) {
  const adv = toNonNegativeAmount(advanceAmount);
  const credit = toNonNegativeAmount(applyCreditAmount);
  const sec = paidSecurityAmt ? toNonNegativeAmount(deposit) : 0;
  return round2(adv + credit + sec);
}

/**
 * @param {object} params
 * @param {number} params.grandTotal
 * @param {number} params.advanceAmount
 * @param {number} params.applyCreditAmount
 */
export function computePayableBalance({ grandTotal, advanceAmount, applyCreditAmount }) {
  const paidTowardBill = round2(
    toNonNegativeAmount(advanceAmount) + toNonNegativeAmount(applyCreditAmount)
  );
  return round2(Math.max(0, toNonNegativeAmount(grandTotal) - paidTowardBill));
}
