import assert from 'node:assert/strict';
import test from 'node:test';

import { bookingEditSettlementSchema } from './bookingEditSettlement.js';

test('only explicit changed payment totals require expected original totals', () => {
  assert.equal(bookingEditSettlementSchema.safeParse({ payment_date: '2026-09-05' }).success, true);
  assert.equal(
    bookingEditSettlementSchema.safeParse({ payment_date: '2026-09-05', security_net: 20 }).success,
    false
  );
  assert.equal(
    bookingEditSettlementSchema.safeParse({
      payment_date: '2026-09-05',
      security_net: 20,
      expected_security_net: 20,
    }).success,
    true
  );
});

test('booking edit money rejects invalid date and nonfinite or negative values', () => {
  assert.equal(
    bookingEditSettlementSchema.safeParse({
      payment_date: '2026-02-30',
      advance_net: 2,
      expected_advance_net: 0,
    }).success,
    false
  );
  assert.equal(
    bookingEditSettlementSchema.safeParse({
      payment_date: '2026-09-05',
      advance_net: Infinity,
      expected_advance_net: 0,
    }).success,
    false
  );
  assert.equal(
    bookingEditSettlementSchema.safeParse({
      payment_date: '2026-09-05',
      security_net: -1,
      expected_security_net: 0,
    }).success,
    false
  );
});
