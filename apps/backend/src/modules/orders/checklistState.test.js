import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistStateToken } from './checklistState.js';

const order = { id: 'order', shop_id: 'shop', status: 'booked' };
const item = { id: 'item', qty: 1, product_id: 'product', stage_flags: { prepared: false } };
test('checklist token is stable across SQL JSON representations and row order', () => {
  const other = { ...item, id: 'other' };
  assert.equal(
    checklistStateToken(order, [item, other], [], [], []),
    checklistStateToken(
      order,
      [other, { ...item, qty: '1', stage_flags: JSON.stringify(item.stage_flags) }],
      [],
      [],
      []
    )
  );
});
test('stage, identity, affected quantity and funded assessment changes invalidate checklist state', () => {
  const token = checklistStateToken(order, [item], [], [], []);
  for (const patch of [
    { stage_flags: { prepared: true } },
    { product_id: 'new' },
    { qty: 2 },
    { missing: true },
    { replacement_version: 1 },
  ]) {
    assert.notEqual(checklistStateToken(order, [{ ...item, ...patch }], [], [], []), token);
  }
  assert.notEqual(checklistStateToken(order, [item], [], [], [{ id: 'funding' }]), token);
  assert.notEqual(
    checklistStateToken(order, [item], [], [{ id: 'assessment', amount: 20 }], []),
    token
  );
});
