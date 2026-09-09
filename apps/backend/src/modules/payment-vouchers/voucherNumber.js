export const PAYMENT_VOUCHER_SEQUENCE_KEY = 'payment_voucher.next_sequence';

export function formatPaymentVoucherNumber(sequence) {
  const safe = Math.max(1, Math.floor(Number(sequence) || 1));
  return `PV-${String(safe).padStart(6, '0')}`;
}

export function nextPaymentVoucherSequenceStart(voucherNumbers) {
  let max = 0;
  let count = 0;
  for (const value of voucherNumbers || []) {
    count += 1;
    const match = String(value || '')
      .trim()
      .match(/^PV-?(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return Math.max(max, count) + 1;
}
