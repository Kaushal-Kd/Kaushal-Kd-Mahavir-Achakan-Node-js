import assert from 'node:assert/strict';
import test from 'node:test';

import { sortCategoriesAZ } from './categoryOrder.js';

test('sortCategoriesAZ orders names A–Z and does not mutate the input', () => {
  const items = [
    { id: '3', label: 'Jodhpuri Coat' },
    { id: '1', label: 'Angarakhu-Achkan' },
    { id: '2', label: 'Anarkali' },
  ];
  const sorted = sortCategoriesAZ(items);
  assert.deepEqual(sorted.map((c) => c.label), ['Anarkali', 'Angarakhu-Achkan', 'Jodhpuri Coat']);
  assert.equal(items[0].label, 'Jodhpuri Coat');
});

test('sortCategoriesAZ treats empty and missing labels as empty strings', () => {
  assert.deepEqual(sortCategoriesAZ(null), []);
  assert.equal(sortCategoriesAZ([{ label: 'Belt' }, { label: '' }])[0].label, '');
});
