import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOrdersListSortParam } from './listOrderSort.js';

test('date-based order lists sort earliest first with bill number as tie-breaker', () => {
  assert.equal(buildOrdersListSortParam('pickup_date'), 'o.pickup_date,o.bill_no');
  assert.equal(buildOrdersListSortParam('return_date'), 'o.return_date,o.bill_no');
});

test('an invalid sort falls back to earliest pickup then bill number', () => {
  assert.equal(buildOrdersListSortParam('not-a-column'), 'o.pickup_date,o.bill_no');
});
