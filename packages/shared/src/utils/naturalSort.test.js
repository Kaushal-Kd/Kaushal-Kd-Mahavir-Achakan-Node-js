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
