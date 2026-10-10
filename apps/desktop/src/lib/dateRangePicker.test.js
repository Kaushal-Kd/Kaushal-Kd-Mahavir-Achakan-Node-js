import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDateRangeClick,
  formatDateRangeDisplay,
  isIsoInInclusiveRange,
  normalizeDateRange,
} from './dateRangePicker.js';

test('normalizeDateRange swaps inverted bounds', () => {
  assert.deepEqual(normalizeDateRange('2026-10-12', '2026-10-09'), {
    from: '2026-10-09',
    to: '2026-10-12',
  });
  assert.deepEqual(normalizeDateRange('2026-10-09', ''), {
    from: '2026-10-09',
    to: '2026-10-09',
  });
});

test('formatDateRangeDisplay uses one date for a single day', () => {
  assert.equal(formatDateRangeDisplay('2026-10-09', '2026-10-09'), '09-10-2026');
  assert.equal(formatDateRangeDisplay('2026-10-09', '2026-10-12'), '09-10-2026 – 12-10-2026');
});

test('applyDateRangeClick starts then completes a range in one calendar', () => {
  const start = applyDateRangeClick({ from: '2026-10-09', to: '2026-10-09', picking: false }, '2026-10-07');
  assert.deepEqual(start, { from: '2026-10-07', to: '', picking: true });
  const done = applyDateRangeClick(start, '2026-10-10');
  assert.deepEqual(done, { from: '2026-10-07', to: '2026-10-10', picking: false });
  const swapped = applyDateRangeClick(start, '2026-10-01');
  assert.deepEqual(swapped, { from: '2026-10-01', to: '2026-10-07', picking: false });
});

test('isIsoInInclusiveRange covers start, middle, and end', () => {
  assert.equal(isIsoInInclusiveRange('2026-10-09', '2026-10-09', '2026-10-12'), true);
  assert.equal(isIsoInInclusiveRange('2026-10-11', '2026-10-09', '2026-10-12'), true);
  assert.equal(isIsoInInclusiveRange('2026-10-08', '2026-10-09', '2026-10-12'), false);
});
