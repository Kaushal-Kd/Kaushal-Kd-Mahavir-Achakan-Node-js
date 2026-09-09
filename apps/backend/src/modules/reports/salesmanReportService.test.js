import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateSalesmanBillDiscount, calculateSalesmanCommission, compareSalesmanReportRows } from './salesmanReportService.js';

test('salesman report sorts by date first and salesman name second', () => {
  const rows = [
    { bill_date: '2027-01-03', salesman_name: 'Asha' },
    { bill_date: '2027-01-02', salesman_name: 'Zara' },
    { bill_date: '2027-01-02', salesman_name: 'Asha' },
  ].sort(compareSalesmanReportRows);
  assert.deepEqual(
    rows.map((row) => `${row.bill_date}:${row.salesman_name}`),
    ['2027-01-02:Asha', '2027-01-02:Zara', '2027-01-03:Asha']
  );
});

test('commission uses the configured fixed booking or product rate', () => {
  assert.equal(calculateSalesmanCommission('booking', 100, 3, 20), 300);
  assert.equal(calculateSalesmanCommission('product', 25, 3, 4), 100);
  assert.equal(calculateSalesmanCommission(null, 25, 3, 4), 0);
});

test('filtering a salesman does not assign the whole booking discount to their lines', () => {
  assert.equal(allocateSalesmanBillDiscount(20, 100, 200), 10);
  assert.equal(allocateSalesmanBillDiscount(20, 200, 200), 20);
  assert.equal(allocateSalesmanBillDiscount(20, 0, 0), 0);
});
