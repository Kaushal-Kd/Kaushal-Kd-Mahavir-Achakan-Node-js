import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateGstAllocation, gstInvoiceAllocationSchema } from '@wrs/shared';

import {
  applyGstDraftPercentage,
  createGstInvoiceDraft,
  getGstSourceIssues,
  normalizeGstInvoiceInput,
  readGstDecimal,
  readGstPercentage,
} from './gstInvoiceDraft.js';

const source = {
  source_type: 'booking',
  source_id: '11111111-1111-4111-8111-111111111111',
  source_fingerprint: 'a'.repeat(64),
  source_number: 'TEST-8500',
  total_amount: 8500,
  supplier: { name: 'Synthetic shop', address: 'Synthetic address', gstin: '29AAAAA0000A1Z5' },
  customer_name: 'Test customer',
  customer_address: 'Synthetic customer address',
  lines: [
    { line_key: 'a', name: 'Test rental A', qty: 1, gross_amount: 5000 },
    { line_key: 'b', name: 'Test rental B', qty: 1, gross_amount: 3500 },
  ],
};

test('GST percentage typing preserves empty and partial text without resetting line amounts', () => {
  let draft = createGstInvoiceDraft(source, 20, 5);
  for (const text of ['', '0', '0.']) {
    draft = applyGstDraftPercentage(draft, text);
    assert.equal(draft.input.percentage, text);
    assert.deepEqual(
      draft.input.components.map((line) => line.gst_gross),
      [1000, 700]
    );
  }
  draft = applyGstDraftPercentage(draft, '0.5');
  assert.equal(draft.input.percentage, '0.5');
  assert.deepEqual(
    draft.input.components.map((line) => line.gst_gross),
    [25, 17.5]
  );
  draft = applyGstDraftPercentage(draft, '20.');
  assert.equal(draft.input.percentage, '20.');
  assert.deepEqual(
    draft.input.components.map((line) => line.gst_gross),
    [1000, 700]
  );
});

test('typed and pasted decimal rates are accepted without spinner controls or clamping', () => {
  for (const [text, expected] of [
    ['5', 5],
    [' 5.00 ', 5],
    ['0.5', 0.5],
    ['.5', 0.5],
    ['5.', 5],
  ])
    assert.equal(readGstPercentage(text), expected);
  assert.equal(readGstDecimal('0'), 0);
  for (const text of ['', '.', '-5', '5%', '1e1', '5.001', 'Infinity', '0', '101'])
    assert.throws(() => readGstPercentage(text));
});

test('review normalizes editable text to schema-valid numbers and preserves the 8500 split', () => {
  const draft = createGstInvoiceDraft(source, '20', 5);
  draft.input.components = draft.input.components.map((line, index) => ({
    ...line,
    gst_gross: index === 0 ? '1000' : '700.00',
    tax_rate: '5.',
    hsn_sac: '1111',
    non_gst_reason: 'TEST ONLY: simulated non-GST component',
  }));
  const input = normalizeGstInvoiceInput(draft.input);
  assert.equal(gstInvoiceAllocationSchema.safeParse(input).success, true);
  assert.equal(draft.input.components[0].tax_rate, '5.');
  const totals = calculateGstAllocation(source, input);
  assert.equal(totals.taxable_value, 1619.05);
  assert.equal(totals.tax_total, 80.95);
  assert.equal(totals.grand_total, 1700);
  assert.equal(totals.non_gst_amount, 6800);
  draft.input.components[0].tax_rate = '';
  assert.throws(() => normalizeGstInvoiceInput(draft.input), /Item 1 GST tax rate/);
  draft.input.components[0].tax_rate = '5';
  draft.input.components[1].gst_gross = '';
  assert.throws(() => normalizeGstInvoiceInput(draft.input), /Item 2 GST portion/);
});

test('missing shop setup is explained separately from optional recipient GSTIN', () => {
  assert.deepEqual(getGstSourceIssues(source), []);
  const issues = getGstSourceIssues({ ...source, supplier: { gstin: '', address: '' } });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /supplier GSTIN and address/);
  assert.match(issues[0], /Recipient GSTIN is the customer's GSTIN/);
  assert.match(
    getGstSourceIssues({ ...source, customer_address: '' })[0],
    /customer name and address/
  );
});
