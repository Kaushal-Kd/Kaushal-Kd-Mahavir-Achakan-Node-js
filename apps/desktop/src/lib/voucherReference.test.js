import assert from 'node:assert/strict';
import test from 'node:test';

import { voucherReferenceHref } from './voucherReference.js';

test('finance receipt/payment references point to their distinct voucher documents', () => {
  assert.equal(
    voucherReferenceHref('receipt_voucher', 'receipt-1'),
    '/receipt-vouchers?edit=receipt-1'
  );
  assert.equal(
    voucherReferenceHref('payment_voucher', 'payment-1'),
    '/payment-vouchers?edit=payment-1'
  );
  assert.equal(
    voucherReferenceHref('payment_voucher', 'id&edit=other'),
    '/payment-vouchers?edit=id%26edit%3Dother'
  );
});

test('missing or unrelated voucher identifiers do not invent a document link', () => {
  assert.equal(voucherReferenceHref('receipt_voucher', null), null);
  assert.equal(voucherReferenceHref('payment_voucher', '  '), null);
  assert.equal(voucherReferenceHref('booking', 'booking-1'), null);
});
