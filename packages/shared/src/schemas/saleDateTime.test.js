import assert from 'node:assert/strict';
import test from 'node:test';

import { createSaleBodySchema } from './sale.js';

const base = {
  customer_name: 'Customer',
  items: [{ name_snapshot: 'Item' }],
};

test('sale_date accepts date-only and stores midnight datetime', () => {
  const parsed = createSaleBodySchema.parse({ ...base, sale_date: '2026-08-17' });
  assert.equal(parsed.sale_date, '2026-08-17 00:00:00');
});

test('sale_date accepts datetime-local values', () => {
  const parsed = createSaleBodySchema.parse({ ...base, sale_date: '2026-10-12T20:14' });
  assert.equal(parsed.sale_date, '2026-10-12 20:14:00');
});

test('sale_date rejects invalid values', () => {
  assert.equal(createSaleBodySchema.safeParse({ ...base, sale_date: '' }).success, false);
  assert.equal(createSaleBodySchema.safeParse({ ...base, sale_date: '12-10-2026' }).success, false);
});
