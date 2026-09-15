import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateSalesmanBillDiscount,
  calculateDeliveredCommissionEntries,
  calculateSalesmanCommission,
  compareSalesmanReportRows,
} from './salesmanReportService.js';

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

test('delivery commission is additive, category-aware, and includes the mapped manager', () => {
  const entries = calculateDeliveredCommissionEntries({
    orders: [
      { id: 'o1', sales_person_id: 'salesman', first_delivered_at: '2026-09-10 10:00:00' },
      { id: 'o2', sales_person_id: 'manager', first_delivered_at: '2026-09-11 10:00:00' },
    ],
    productLines: [
      { order_id: 'o1', sales_person_id: null, category_id: 'formal', qty: 2 },
      { order_id: 'o1', sales_person_id: null, category_id: 'other', qty: 1 },
      { order_id: 'o2', sales_person_id: null, category_id: 'formal', qty: 1 },
    ],
    memberships: [
      {
        user_id: 'salesman',
        user_name: 'Salesman',
        manager_user_id: 'manager',
        self_booking_commission_rate: 100,
        self_product_commission_rate: 10,
      },
      {
        user_id: 'manager',
        user_name: 'Manager',
        self_booking_commission_rate: 200,
        self_product_commission_rate: 15,
        managed_booking_commission_rate: 50,
        managed_product_commission_rate: 5,
      },
    ],
    categoryRates: [
      { user_id: 'salesman', category_id: 'formal', self_rate: 20, managed_rate: 0 },
      { user_id: 'manager', category_id: 'formal', self_rate: 30, managed_rate: 7 },
    ],
  });

  assert.deepEqual(
    entries.map((entry) => ({
      user: entry.sales_person_id,
      date: entry.bill_date,
      amount: entry.commission_amount,
    })),
    [
      { user: 'salesman', date: '2026-09-10', amount: 150 },
      { user: 'manager', date: '2026-09-10', amount: 69 },
      { user: 'manager', date: '2026-09-11', amount: 230 },
    ]
  );
});

test('filtering a salesman does not assign the whole booking discount to their lines', () => {
  assert.equal(allocateSalesmanBillDiscount(20, 100, 200), 10);
  assert.equal(allocateSalesmanBillDiscount(20, 200, 200), 20);
  assert.equal(allocateSalesmanBillDiscount(20, 0, 0), 0);
});
