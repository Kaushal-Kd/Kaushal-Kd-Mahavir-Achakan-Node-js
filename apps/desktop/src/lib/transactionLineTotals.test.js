import assert from 'node:assert/strict';
import test from 'node:test';

import { computeItemTotals, computeTransactionTotals } from './transactionLineTotals.js';

test('calculates GST percentages against taxable amount and quantity', () => {
  const item = computeItemTotals({
    qty: 2,
    price: 1000,
    discount: 100,
    cgst_percent: 9,
    sgst_percent: 9,
    igst_percent: 0,
  });

  assert.equal(item.taxable_price, 900);
  assert.equal(item.cgst_amount, 162);
  assert.equal(item.sgst_amount, 162);
  assert.equal(item.net_price, 2124);
  assert.equal(item.total_amount, 2124);
});

test('sums GST bill totals without dropping percentage-derived tax', () => {
  const totals = computeTransactionTotals(
    [
      {
        qty: 1,
        price: 1000,
        discount: 0,
        cgst_percent: 9,
        sgst_percent: 9,
        igst_percent: 0,
      },
    ],
    { type: 'flat', value: 0 }
  );

  assert.deepEqual(totals, {
    subtotal: 1000,
    cgst_total: 90,
    sgst_total: 90,
    igst_total: 0,
    tax_total: 180,
    net_amount: 1180,
    discount_amount: 0,
    total_amount: 1180,
    total_qty: 1,
  });
});
