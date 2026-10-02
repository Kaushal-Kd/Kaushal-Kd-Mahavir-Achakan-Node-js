import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPaymentVoucherNumber, nextPaymentVoucherSequenceStart } from './voucherNumber.js';

test('formats payment vouchers as a readable sequential series', () => {
  assert.equal(formatPaymentVoucherNumber(1), 'PV-0001');
  assert.equal(formatPaymentVoucherNumber(42), 'PV-0042');
  assert.equal(formatPaymentVoucherNumber(42, 'PAY'), 'PAY-0042');
});

test('continues after sequential numbers and ignores date/hex ids', () => {
  assert.equal(
    nextPaymentVoucherSequenceStart(['PV20260904-A1B2C3', 'PV20260904-D4E5F6', 'PV-000007']),
    8
  );
  assert.equal(nextPaymentVoucherSequenceStart(['legacy-one', 'legacy-two']), 1);
  assert.equal(nextPaymentVoucherSequenceStart(['PV-0002'], 50, 'PV'), 50);
});
