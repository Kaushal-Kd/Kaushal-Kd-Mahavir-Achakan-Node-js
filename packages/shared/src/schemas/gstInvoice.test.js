import assert from 'node:assert/strict';
import test from 'node:test';
import { gstInvoiceIssueSchema, gstInvoiceQuerySchema } from './gstInvoice.js';
import {
  calculateGstAllocation,
  allocateGstGross,
  gstFinancialYear,
} from '../utils/gstAllocation.js';

const source = {
  total_amount: 10000,
  supplier: { gstin: '24ABCDE1234F1Z5' },
  lines: [{ line_key: 'one', gross_amount: 10000, qty: 1 }],
};
const allocation = {
  source_type: 'booking',
  source_id: '11111111-1111-4111-8111-111111111111',
  source_fingerprint: 'a'.repeat(64),
  percentage: 20,
  recipient_gstin: '',
  place_of_supply: '24',
  components: [
    {
      line_key: 'one',
      description: 'Taxable rental service component',
      hsn_sac: '997329',
      gst_gross: 2000,
      tax_rate: 5,
      non_gst_reason: 'Documented non-taxable component',
    },
  ],
};
const command = {
  idempotency_key: '22222222-2222-4222-8222-222222222222',
  max_amount: 10000,
  invoices: [allocation],
};

test('inclusive allocation retains original total and separates GST from documented remainder', () => {
  const out = calculateGstAllocation(source, allocation);
  assert.equal(out.grand_total, 2000);
  assert.equal(out.taxable_value, 1904.76);
  assert.equal(out.tax_total, 95.24);
  assert.equal(out.cgst, 47.62);
  assert.equal(out.sgst, 47.62);
  assert.equal(out.non_gst_amount, 8000);
  assert.equal(source.total_amount, 10000);
  const interstate = calculateGstAllocation(source, { ...allocation, place_of_supply: '27' });
  assert.equal(interstate.igst, 95.24);
  assert.equal(interstate.cgst, 0);
});
test('allocation must reconcile exact source components and document every non-GST remainder', () => {
  for (const change of [
    { gst_gross: 2001 },
    { gst_gross: 10001 },
    { non_gst_reason: '' },
    { line_key: 'other' },
    { tax_rate: 0 },
  ]) {
    assert.throws(() =>
      calculateGstAllocation(source, {
        ...allocation,
        components: [{ ...allocation.components[0], ...change }],
      })
    );
  }
  assert.throws(() =>
    calculateGstAllocation(source, {
      ...allocation,
      components: [...allocation.components, ...allocation.components],
    })
  );
});
test('multiple rates, 100% allocations and paise rounding reconcile without lost money', () => {
  assert.deepEqual(allocateGstGross(0.05, [1, 1, 1]), [0.02, 0.02, 0.01]);
  const two = {
    ...source,
    total_amount: 3,
    lines: [
      { line_key: 'a', gross_amount: 1 },
      { line_key: 'b', gross_amount: 2 },
    ],
  };
  const out = calculateGstAllocation(two, {
    percentage: 100,
    place_of_supply: '24',
    components: [
      { line_key: 'a', gst_gross: 1, tax_rate: 5 },
      { line_key: 'b', gst_gross: 2, tax_rate: 18 },
    ],
  });
  assert.equal(Math.round((out.taxable_value + out.tax_total) * 100), 300);
  assert.equal(out.non_gst_amount, 0);
  assert.equal(out.cgst + out.sgst, out.tax_total);
});
test('strict issue schemas reject duplicate sources, invalid rates, dates and fractional paise', () => {
  assert.equal(gstInvoiceIssueSchema.safeParse(command).success, true);
  assert.equal(
    gstInvoiceIssueSchema.safeParse({ ...command, invoices: [allocation, allocation] }).success,
    false
  );
  assert.equal(gstInvoiceIssueSchema.safeParse({ ...command, max_amount: 100.001 }).success, false);
  assert.equal(
    gstInvoiceIssueSchema.safeParse({ ...command, invoices: [{ ...allocation, percentage: 101 }] })
      .success,
    false
  );
  assert.equal(gstInvoiceIssueSchema.safeParse({ ...command, shop_id: 'forged' }).success, false);
  assert.equal(
    gstInvoiceQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    false
  );
  assert.equal(
    gstInvoiceQuerySchema.safeParse({ from: '2026-09-08', to: '2026-09-01' }).success,
    false
  );
});
test('GST sequence year changes on April 1', () => {
  assert.equal(gstFinancialYear('2026-03-31'), '25-26');
  assert.equal(gstFinancialYear('2026-04-01'), '26-27');
});
