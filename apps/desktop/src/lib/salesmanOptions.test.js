import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSalesmanSelectOptions } from './salesmanOptions.js';

const shopA = 'shop-a';
const shopB = 'shop-b';

test('omits staff who belong to a different shop', () => {
  const options = buildSalesmanSelectOptions(
    [
      { id: 'u1', name: 'Local salesman', role: 'salesman', shop_ids: [shopA] },
      { id: 'u2', name: 'Other shop', role: 'salesman', shop_ids: [shopB] },
    ],
    { id: 'admin', name: 'Admin', role: 'shop_admin', shop_ids: [shopB] },
    [],
    shopA
  );
  assert.deepEqual(
    options.map((row) => row.value),
    ['u1']
  );
});

test('does not inject the logged-in user when they are not assigned to this shop', () => {
  const options = buildSalesmanSelectOptions(
    [{ id: 'u1', name: 'Local salesman', role: 'salesman', shop_ids: [shopA] }],
    { id: shopB, name: 'Kuvarsa Achkan', role: 'shop_admin', shop_ids: [shopB] },
    [],
    shopA
  );
  assert.deepEqual(
    options.map((row) => row.value),
    ['u1']
  );
});

test('keeps a historical extra salesman on edit even if they left the shop', () => {
  const options = buildSalesmanSelectOptions(
    [{ id: 'u1', name: 'Local salesman', role: 'salesman', shop_ids: [shopA] }],
    null,
    [{ id: 'old', label: 'Former staff' }],
    shopA
  );
  assert.deepEqual(
    options.map((row) => row.value).sort(),
    ['old', 'u1']
  );
});
