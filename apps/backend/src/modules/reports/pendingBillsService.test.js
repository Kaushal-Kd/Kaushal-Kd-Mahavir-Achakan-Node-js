import assert from 'node:assert/strict';
import test from 'node:test';

import { pendingBillsQuerySchema } from '@wrs/shared';

import { mapPendingBillRow } from './pendingBillsService.js';

test('pending bills export allows 500 rows per page', () => {
  const parsed = pendingBillsQuerySchema.parse({ per_page: 500 });
  assert.equal(parsed.per_page, 500);
});

test('pending bill rows include a rounded advance amount', () => {
  assert.deepEqual(
    mapPendingBillRow({
      id: 'order-1',
      order_number: 'BK-001',
      bill_no: '12',
      pickup_name: 'Customer',
      pickup_number: '9000000000',
      total_amount: '1000.004',
      advance_amount: '250.555',
      balance: '749.449',
      status: 'returned',
      return_date: '2026-09-05',
      reference_name: null,
      address: null,
    }),
    {
      id: 'order-1',
      order_number: 'BK-001',
      bill_no: 12,
      pickup_name: 'Customer',
      pickup_number: '9000000000',
      total_amount: 1000,
      advance_amount: 250.56,
      balance: 749.45,
      status: 'returned',
      return_date: '2026-09-05',
      reference_name: null,
      address: '',
    }
  );
});
