import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateKacchaBillTotals } from './service.js';

test('GST Sale conversion recalculates a percentage discount after removing tax', () => {
  assert.deepEqual(
    calculateKacchaBillTotals(
      {
        net_amount: 1180,
        tax_total: 180,
        discount_type: 'percent',
        discount_value: 10,
        discount_amount: 118,
        total_amount: 1062,
      },
      'sale'
    ),
    { net_amount: 1000, discount_amount: 100, total_amount: 900 }
  );
});

test('GST Sale conversion keeps a flat discount capped by the tax-free net amount', () => {
  assert.deepEqual(
    calculateKacchaBillTotals(
      {
        net_amount: 1180,
        tax_total: 180,
        discount_type: 'flat',
        discount_value: 1200,
        total_amount: 0,
      },
      'sale'
    ),
    { net_amount: 1000, discount_amount: 1000, total_amount: 0 }
  );
});

test('GST Booking conversion removes exclusive tax from the payable total', () => {
  assert.deepEqual(
    calculateKacchaBillTotals(
      {
        subtotal: 1200,
        discount_total: 200,
        extra_charges: 50,
        tax_total: 180,
        total_amount: 1230,
      },
      'booking'
    ),
    { total_amount: 1050 }
  );
});

test('GST Booking conversion does not reduce an inclusive-tax payable total twice', () => {
  assert.deepEqual(
    calculateKacchaBillTotals(
      {
        subtotal: 1200,
        discount_total: 200,
        extra_charges: 50,
        tax_total: 160.17,
        total_amount: 1050,
      },
      'booking'
    ),
    { total_amount: 1050 }
  );
});
