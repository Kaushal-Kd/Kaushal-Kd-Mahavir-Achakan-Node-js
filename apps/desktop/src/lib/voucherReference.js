export function voucherReferenceHref(kind, id) {
  const value = String(id || '').trim();
  if (!value) return null;
  if (kind === 'receipt_voucher') return `/receipt-vouchers?edit=${encodeURIComponent(value)}`;
  if (kind === 'payment_voucher') return `/payment-vouchers?edit=${encodeURIComponent(value)}`;
  return null;
}
