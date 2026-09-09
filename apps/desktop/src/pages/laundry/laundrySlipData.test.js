import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateVendorOutstandingAmounts, paginateLaundryCodeGroups, MAX_CODE_ROWS_PER_COLUMN } from './laundrySlipData.js';

test('large washing categories paginate without losing or duplicating any product codes', () => {
  const entries = Array.from({ length: 600 }, (_, index) => ({ code: `P${index + 1}`, priority: 'Medium' }));
  const groups = paginateLaundryCodeGroups([{ label: 'Sherwani', entries }]);
  assert.equal(groups.length, Math.ceil(600 / MAX_CODE_ROWS_PER_COLUMN));
  assert.ok(groups.every((group) => group.entries.length <= MAX_CODE_ROWS_PER_COLUMN));
  assert.deepEqual(groups.flatMap((group) => group.entries), entries);
  assert.equal(groups[0].label, 'Sherwani (1/22)');
  assert.equal(groups.at(-1).label, 'Sherwani (22/22)');
  assert.deepEqual(paginateLaundryCodeGroups([{ label: 'Single', entries: entries.slice(0, 1) }]), [{ label: 'Single', entries: entries.slice(0, 1) }]);
});

test('separates old washing dues from the current bill in final pending total', () => {
  const result = calculateVendorOutstandingAmounts({
    outstanding: {
      bills: [
        { id: 'old', jobNo: 'W0001', remaining: 300 },
        { id: 'current', jobNo: 'W0002', remaining: 400 },
      ],
      totals: { totalRemaining: 700 },
    },
    currentBillAmount: 500,
    currentBillId: 'current',
  });

  assert.deepEqual(result, {
    currentBill: 500,
    currentOutstanding: 400,
    oldPending: 300,
    totalPending: 700,
  });
});
