import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeAccessoryBookingConflicts,
  calculateAccessoryWashingAvailability,
} from './washingAvailability.js';

test('received accessory lines are not counted again while they are washing', () => {
  const conflicts = activeAccessoryBookingConflicts([
    { id: 'pending', qty: 2, stage_flags: JSON.stringify({ received: false }) },
    { id: 'received-object', qty: 3, stage_flags: { received: true } },
    { id: 'received-legacy', qty: 4, stage_flags: JSON.stringify({ received: 'true' }) },
  ]);

  assert.deepEqual(conflicts.map((row) => row.id), ['pending']);
  assert.deepEqual(
    calculateAccessoryWashingAvailability({
      rentableQty: 10,
      bookedQty: conflicts.reduce((sum, row) => sum + Number(row.qty || 0), 0),
      washingQueueRows: [{ qty: 3 }],
      laundryWashingRows: [],
    }),
    { washingQueueQty: 3, laundryWashingQty: 0, washingQty: 3, freeQty: 5 }
  );
});

test('accessory availability subtracts booked, queued, and in-washing quantities', () => {
  assert.deepEqual(
    calculateAccessoryWashingAvailability({
      rentableQty: 10,
      bookedQty: 3,
      washingQueueRows: [{ qty: 2 }],
      laundryWashingRows: [{ qty: 1 }, { qty: 1 }],
    }),
    { washingQueueQty: 2, laundryWashingQty: 2, washingQty: 4, freeQty: 3 }
  );
});

test('accessory free quantity never becomes negative', () => {
  const result = calculateAccessoryWashingAvailability({
    rentableQty: 2,
    bookedQty: 2,
    washingQueueRows: [{ qty: 2 }],
    laundryWashingRows: [{ qty: 2 }],
  });
  assert.equal(result.freeQty, 0);
});
