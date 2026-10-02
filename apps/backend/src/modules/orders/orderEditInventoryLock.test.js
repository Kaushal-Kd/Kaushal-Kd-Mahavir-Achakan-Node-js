import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDeliveryDatePast,
  resolveLineGivenStatus,
  sameInventoryLine,
} from './orderEditInventoryLock.js';

test('delivery date is not past on D or before D', () => {
  assert.equal(isDeliveryDatePast('2026-10-02', '2026-10-02'), false);
  assert.equal(isDeliveryDatePast('2026-10-03', '2026-10-02'), false);
});

test('delivery date is past after D', () => {
  assert.equal(isDeliveryDatePast('2026-10-01', '2026-10-02'), true);
});

test('given-with-rent status resolves from flags or column', () => {
  assert.equal(resolveLineGivenStatus({ given_status: 'given_with_rent' }), 'given_with_rent');
  assert.equal(resolveLineGivenStatus({ given_with_rent: true }), 'given_with_rent');
  assert.equal(resolveLineGivenStatus({ pack_with_rent: true }), 'pack_with_rent');
  assert.equal(resolveLineGivenStatus({}), 'regular');
});

test('changing given-with-rent status is an inventory change', () => {
  const before = {
    accessory_id: 'a1',
    type: 'rent',
    qty: 1,
    given_status: 'given_with_rent',
  };
  const after = { accessory_id: 'a1', type: 'rent', qty: 1, given_with_rent: false };
  assert.equal(sameInventoryLine(before, after, 'accessory'), false);
  assert.equal(
    sameInventoryLine(before, { ...after, given_with_rent: true }, 'accessory'),
    true
  );
});

test('qty change is an inventory change', () => {
  const before = { accessory_id: 'a1', type: 'rent', qty: 1, given_status: 'regular' };
  const after = { accessory_id: 'a1', type: 'rent', qty: 2, given_status: 'regular' };
  assert.equal(sameInventoryLine(before, after, 'accessory'), false);
});
