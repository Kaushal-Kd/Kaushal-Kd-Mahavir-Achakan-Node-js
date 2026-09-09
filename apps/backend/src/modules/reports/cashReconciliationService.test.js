import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCashClosing } from './cashReconciliationService.js';

test('cash closing calculates expected cash and a positive overage', () => {
  assert.deepEqual(calculateCashClosing(1000, 750.5, 200.25, 1600), {
    opening_cash: 1000,
    income_total: 750.5,
    expense_total: 200.25,
    expected_closing: 1550.25,
    counted_closing: 1600,
    variance: 49.75,
  });
});

test('cash closing reports a negative shortage and rounds monetary values', () => {
  assert.deepEqual(calculateCashClosing(100.005, 20.005, 5.005, 114), {
    opening_cash: 100.01,
    income_total: 20.01,
    expense_total: 5.01,
    expected_closing: 115.01,
    counted_closing: 114,
    variance: -1.01,
  });
});
