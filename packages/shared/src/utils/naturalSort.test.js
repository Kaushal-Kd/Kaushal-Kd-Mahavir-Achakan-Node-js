import assert from 'node:assert/strict';
import test from 'node:test';

import { naturalSortKey } from './naturalSort.js';

test('naturalSortKey orders digit runs numerically', () => {
  const values = ['P10', 'P2', 'P1', 'P02-A', 'P2-B'];
  const sorted = [...values].sort((a, b) => naturalSortKey(a).localeCompare(naturalSortKey(b)));

  assert.deepEqual(sorted, ['P1', 'P2', 'P02-A', 'P2-B', 'P10']);
});

test('naturalSortKey is case-insensitive and handles multiple digit runs', () => {
  assert.equal(naturalSortKey(' AB-2/10 '), naturalSortKey('ab-02/010'));
});

test('code numbers sort 1, 2, 40, 164, 1684 instead of name text', () => {
  const codes = ['A-0001[38]', 'A-1684[38]', 'A-0040[34]', 'A-0164[40]', 'A-0002[46]'];
  const firstNumber = (value) => Number(String(value).match(/\d+/)?.[0] || 0);
  const sorted = [...codes].sort((a, b) => firstNumber(a) - firstNumber(b) || a.localeCompare(b));
  assert.deepEqual(sorted, ['A-0001[38]', 'A-0002[46]', 'A-0040[34]', 'A-0164[40]', 'A-1684[38]']);
});
