import assert from 'node:assert/strict';
import test from 'node:test';

import { securityDueQuerySchema, securityTransactionsQuerySchema } from './payment.js';
import { salesmanReportQuerySchema } from './product.js';
import { salesmanCommissionSchema } from './user.js';

test('salesman report accepts either a month or an ordered custom range', () => {
  assert.equal(salesmanReportQuerySchema.safeParse({ month: '2027-01' }).success, true);
  assert.equal(
    salesmanReportQuerySchema.safeParse({ from: '2027-01-01', to: '2027-01-31' }).success,
    true
  );
  assert.equal(
    salesmanReportQuerySchema.safeParse({ from: '2027-02-01', to: '2027-01-31' }).success,
    false
  );
});

test('salesman report supports the Unassigned filter', () => {
  assert.equal(
    salesmanReportQuerySchema.parse({ month: '2027-01', sales_person_id: 'none' }).sales_person_id,
    'none'
  );
});

test('security report views and Due amount filters reject unknown values', () => {
  assert.equal(securityTransactionsQuerySchema.parse({ view: 'on_hand' }).view, 'on_hand');
  assert.equal(securityTransactionsQuerySchema.safeParse({ view: 'unknown' }).success, false);
  assert.equal(securityDueQuerySchema.parse({ amount_filter: 'pending' }).amount_filter, 'pending');
  assert.equal(securityDueQuerySchema.safeParse({ amount_filter: 'unknown' }).success, false);
});

test('commission is a non-negative fixed amount with an optional basis', () => {
  assert.deepEqual(salesmanCommissionSchema.parse({ basis: 'product', rate: '125.50' }), {
    basis: 'product',
    rate: 125.5,
  });
  assert.equal(salesmanCommissionSchema.safeParse({ basis: 'booking', rate: -1 }).success, false);
});
