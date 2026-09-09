import assert from 'node:assert/strict';
import test from 'node:test';

import { restorePaymentVoucherBillAllocation } from './paymentVoucherEditBalance.js';

test('restores the original allocation when editing a fully paid purchase bill', () => {
  const restored = restorePaymentVoucherBillAllocation(
    { id: 'purchase', total_amount: 100, advance: 100 },
    'purchase',
    40
  );
  assert.equal(restored.advance, 60);
  assert.equal(restored.total_amount - restored.advance, 40);
});

test('restores the original allocation when editing a fully paid washing bill', () => {
  const restored = restorePaymentVoucherBillAllocation(
    { id: 'washing', washing_balance: 0 },
    'washing',
    30
  );
  assert.equal(restored.washing_balance, 30);
});
