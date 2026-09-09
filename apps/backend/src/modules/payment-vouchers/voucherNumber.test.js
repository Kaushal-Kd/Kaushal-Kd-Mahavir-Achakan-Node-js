import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPaymentVoucherNumber, nextPaymentVoucherSequenceStart } from './voucherNumber.js';

test('formats payment vouchers as a readable sequential series', () => {
  assert.equal(formatPaymentVoucherNumber(1), 'PV-000001');
  assert.equal(formatPaymentVoucherNumber(42), 'PV-000042');
});

test('continues after new series numbers and safely accounts for legacy vouchers', () => {
  assert.equal(
    nextPaymentVoucherSequenceStart(['PV20260904-A1B2C3', 'PV20260904-D4E5F6', 'PV-000007']),
    8
  );
  assert.equal(nextPaymentVoucherSequenceStart(['legacy-one', 'legacy-two']), 3);
});
