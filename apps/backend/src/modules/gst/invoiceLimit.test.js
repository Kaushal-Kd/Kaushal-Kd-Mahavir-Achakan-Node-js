import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GST_MONTHLY_INVOICE_LIMIT, remainingGstMonthlyCapacity } from './invoiceService.js';

describe('monthly GST invoice cap', () => {
  it('allows no more than twenty issued invoices per month', () => {
    assert.equal(GST_MONTHLY_INVOICE_LIMIT, 20);
    assert.deepEqual(remainingGstMonthlyCapacity(12, 8), { remaining: 8, allowed: true });
    assert.deepEqual(remainingGstMonthlyCapacity(12, 9), { remaining: 8, allowed: false });
    assert.deepEqual(remainingGstMonthlyCapacity(20, 1), { remaining: 0, allowed: false });
  });
});
