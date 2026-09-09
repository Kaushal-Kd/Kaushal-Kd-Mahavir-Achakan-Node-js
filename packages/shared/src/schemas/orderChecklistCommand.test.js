import assert from 'node:assert/strict';
import test from 'node:test';
import { orderChecklistCommandSchema } from './order.js';

const id = '10000000-0000-4000-8000-000000000001';
const base = { idempotency_key: id, expected_state_token: 'a'.repeat(64) };
const condition = { item_id: id, item_type: 'accessory', damaged: true, condition_qty: 1 };

test('checklist accepts stage-only, condition-only and combined assessment commands', () => {
  for (const payload of [
    { condition_updates: [condition] },
    { stage_updates: [{ item_id: id, field: 'prepared', value: true }] },
    { condition_updates: [condition], combined_assessment: { amount: 20, remarks: 'Damage' } },
  ])
    assert.equal(orderChecklistCommandSchema.safeParse({ ...base, ...payload }).success, true);
});
test('checklist rejects absent state, empty and duplicate commands before writes', () => {
  assert.equal(orderChecklistCommandSchema.safeParse(base).success, false);
  assert.equal(
    orderChecklistCommandSchema.safeParse({ idempotency_key: id, condition_updates: [condition] })
      .success,
    false
  );
  assert.equal(
    orderChecklistCommandSchema.safeParse({ ...base, condition_updates: [condition, condition] })
      .success,
    false
  );
});
test('checklist limits batch size and rejects nonfinite assessments', () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({
    ...condition,
    item_id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  }));
  assert.equal(
    orderChecklistCommandSchema.safeParse({ ...base, condition_updates: rows.slice(0, 500) })
      .success,
    true
  );
  assert.equal(
    orderChecklistCommandSchema.safeParse({ ...base, condition_updates: rows }).success,
    false
  );
  assert.equal(
    orderChecklistCommandSchema.safeParse({ ...base, combined_assessment: { amount: Infinity } })
      .success,
    false
  );
});
