import assert from 'node:assert/strict';
import test from 'node:test';

import { orderItemReplacementSchema } from '@wrs/shared';

import { replacementLineIsStale, replacementRequirementStatus, replacementTargetIsPending } from './rules.js';

const pending = {
  type: 'rent', product_id: 'original', order_status: 'in_preparation',
  pickup_date: '2026-09-06', is_deleted: false, stage_flags: {},
};

test('all three future bookings are eligible independent of near-booking thresholds', () => {
  const bookings = ['2026-09-06', '2026-11-01', '2027-05-12'].map((pickup_date) => ({ ...pending, pickup_date }));
  assert.equal(bookings.filter((row) => replacementTargetIsPending(row, '2026-09-05')).length, 3);
});

test('pending line on partial delivery is included but fulfilled, cancelled and past lines are excluded', () => {
  assert.equal(replacementTargetIsPending({ ...pending, order_status: 'delivered' }, '2026-09-05'), true);
  assert.equal(replacementTargetIsPending({ ...pending, pickup_date: '2026-09-05' }, '2026-09-05'), true);
  for (const patch of [
    { stage_flags: { delivered: true } }, { stage_flags: { received: true } },
    { stage_flags: JSON.stringify({ delivered: '1' }) }, { order_status: 'cancelled' },
    { is_deleted: true }, { pickup_date: '2026-09-04' }, { type: 'sell' },
  ]) assert.equal(replacementTargetIsPending({ ...pending, ...patch }, '2026-09-05'), false);
});

test('replacement remains required after repair and reopens if original product is selected again', () => {
  const requirement = { source_product_id: 'original', status: 'replaced' };
  assert.equal(replacementRequirementStatus(requirement, { product_id: 'original', type: 'rent' }, { status: 'booked' }), 'pending');
  assert.equal(replacementRequirementStatus(requirement, { product_id: 'original', type: 'sell' }, { status: 'booked' }), 'pending');
  assert.equal(replacementRequirementStatus(requirement, { product_id: 'alternate', type: 'rent' }, { status: 'booked' }), 'replaced');
  assert.equal(replacementRequirementStatus(requirement, { product_id: 'original', type: 'rent' }, { status: 'cancelled' }), 'cancelled');
});

test('replacement concurrency token rejects changed identity or quantity version', () => {
  const request = { expected_product_id: 'original', expected_line_version: 1 };
  assert.equal(replacementLineIsStale({ product_id: 'original', replacement_version: 1 }, request), false);
  assert.equal(replacementLineIsStale({ product_id: 'alternate', replacement_version: 1 }, request), true);
  assert.equal(replacementLineIsStale({ product_id: 'original', replacement_version: 2 }, request), true);
});

test('replacement schema requires different product and complete idempotency/version guards', () => {
  const body = {
    replacement_product_id: '11111111-1111-4111-8111-111111111111',
    expected_product_id: '22222222-2222-4222-8222-222222222222',
    expected_line_version: 0,
    idempotency_key: '33333333-3333-4333-8333-333333333333',
  };
  assert.equal(orderItemReplacementSchema.safeParse(body).success, true);
  assert.equal(orderItemReplacementSchema.safeParse({ ...body, replacement_product_id: body.expected_product_id }).success, false);
  assert.equal(orderItemReplacementSchema.safeParse({ ...body, expected_line_version: undefined }).success, false);
  assert.equal(orderItemReplacementSchema.safeParse({ ...body, idempotency_key: undefined }).success, false);
  assert.equal(orderItemReplacementSchema.safeParse({ ...body, skip_checks: true }).success, false);
});
