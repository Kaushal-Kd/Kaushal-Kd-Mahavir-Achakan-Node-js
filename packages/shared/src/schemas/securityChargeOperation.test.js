import assert from 'node:assert/strict';
import test from 'node:test';

import { securityChargeOperationBodySchema } from './securityCharge.js';

const ID = 'ddced017-0068-4261-b3f2-cc67f82f566d';
const base = { idempotency_key: ID, amount: 100, payment_date: '2026-09-05' };

test('collection requires explicit positive money and bank/cash account', () => {
  assert.equal(
    securityChargeOperationBodySchema.safeParse({
      ...base,
      kind: 'collect',
      payment_account_id: 'cash',
    }).success,
    true
  );
  assert.equal(
    securityChargeOperationBodySchema.safeParse({ ...base, kind: 'collect' }).success,
    false
  );
  assert.equal(
    securityChargeOperationBodySchema.safeParse({
      ...base,
      kind: 'collect',
      payment_account_id: 'cash',
      amount: 0,
    }).success,
    false
  );
});

test('refund needs original held lot and exactly one payout account', () => {
  const refund = {
    ...base,
    kind: 'refund',
    funding_operation_id: ID,
    security_account_id: 'security',
  };
  assert.equal(securityChargeOperationBodySchema.safeParse(refund).success, true);
  assert.equal(
    securityChargeOperationBodySchema.safeParse({ ...refund, payment_account_id: 'cash' }).success,
    false
  );
  assert.equal(
    securityChargeOperationBodySchema.safeParse({ ...refund, funding_operation_id: undefined })
      .success,
    false
  );
});

test('settlement needs explicit income target and funding lot', () => {
  const settle = { ...base, kind: 'settle', funding_operation_id: ID, income_account_id: 'income' };
  assert.equal(securityChargeOperationBodySchema.safeParse(settle).success, true);
  assert.equal(
    securityChargeOperationBodySchema.safeParse({ ...settle, income_account_id: undefined })
      .success,
    false
  );
});

test('release is not a cash collection or refund', () => {
  assert.equal(
    securityChargeOperationBodySchema.safeParse({
      ...base,
      kind: 'release',
      funding_operation_id: ID,
    }).success,
    true
  );
});

test('operation dates and finite monetary amounts are validated', () => {
  assert.equal(
    securityChargeOperationBodySchema.safeParse({
      ...base,
      kind: 'retain',
      payment_date: '2026-02-31',
    }).success,
    false
  );
  assert.equal(
    securityChargeOperationBodySchema.safeParse({ ...base, kind: 'retain', amount: Infinity })
      .success,
    false
  );
  assert.equal(
    securityChargeOperationBodySchema.safeParse({ ...base, kind: 'retain', amount: -1 }).success,
    false
  );
});
