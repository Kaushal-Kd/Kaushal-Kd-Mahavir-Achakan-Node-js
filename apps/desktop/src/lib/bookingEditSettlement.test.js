import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBookingEditSettlement } from './bookingEditSettlement.js';

const baseline = { advance: 100, securityNet: 300, depositAmount: 1000, paid: true };
const next = { advance: 100, depositAmount: 1000, paid: true, paymentDate: '2026-09-05' };

test('ordinary booking edit does not recollect partially refunded security', () => {
  assert.equal(buildBookingEditSettlement(baseline, next), undefined);
});
test('advance-only edit cannot change security and carries original expected total', () => {
  const result = buildBookingEditSettlement(baseline, { ...next, advance: 150 });
  assert.equal(result.expected_advance_net, 100);
  assert.equal(result.advance_net, 150);
  assert.equal(result.security_net, undefined);
});
test('explicit security edit carries expected collected total and configured amount', () => {
  const result = buildBookingEditSettlement(baseline, { ...next, paid: false });
  assert.equal(result.expected_security_net, 300);
  assert.equal(result.expected_deposit_amount, 1000);
  assert.equal(result.security_net, 0);
});
