import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIssuedGstHtml,
  buildIssuedGstPdf,
  issuedGstDocumentRows,
} from './gstInvoiceDocument.js';
import { createGstInvoiceDraft, applyGstDraftPercentage } from './gstInvoiceDraft.js';

const source = {
  total_amount: 10000,
  supplier: { name: 'Test supplier', address: 'Test address', gstin: '24ABCDE1234F1Z5' },
  source_number: 'B-1',
  source_type: 'booking',
  source_id: 'test',
  source_fingerprint: 'a'.repeat(64),
  lines: [{ line_key: 'a', name: 'Rent component', qty: 1, gross_amount: 10000 }],
};
const invoice = {
  ...source,
  id: 'issued',
  invoice_number: 'GST/26-27/00001',
  invoice_date: '2026-09-08',
  percentage: 20,
  customer_name: '<script>alert(1)</script>',
  customer_address: 'Customer address',
  place_of_supply: '24',
  tax_mode: 'cgst_sgst',
  taxable_value: 1904.76,
  tax_total: 95.24,
  cgst: 47.62,
  sgst: 47.62,
  igst: 0,
  grand_total: 2000,
  non_gst_amount: 8000,
  lines: [
    {
      line_key: 'a',
      description: '<img onerror="bad">',
      hsn_sac: '997329',
      qty: 1,
      taxable_value: 1904.76,
      tax_total: 95.24,
      gst_gross: 2000,
      tax_rate: 5,
    },
  ],
};
test('GST print escapes user text and cannot print a queued draft as issued', () => {
  const html = buildIssuedGstHtml(invoice);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
  assert.ok(html.includes('GST/26-27/00001'));
  assert.ok(html.includes('INR 2000.00'));
  assert.throws(() => issuedGstDocumentRows({ ...invoice, invoice_number: null }));
});
test('single and long GST PDFs generate complete standalone documents', async () => {
  const short = await buildIssuedGstPdf(invoice);
  assert.equal(short.getNumberOfPages(), 1);
  const long = await buildIssuedGstPdf({
    ...invoice,
    lines: Array.from({ length: 90 }, (_, i) => ({
      ...invoice.lines[0],
      description: `Line ${i} with detailed rental component text for wrapping`,
    })),
  });
  assert.ok(long.getNumberOfPages() > 2);
  assert.match(short.output(), /^%PDF/);
});
test('allocation defaults and per-bill edits distribute exact gross amounts', () => {
  const draft = createGstInvoiceDraft(source, 20, 5);
  assert.equal(draft.input.components[0].gst_gross, 2000);
  const changed = applyGstDraftPercentage(draft, 35);
  assert.equal(changed.input.components[0].gst_gross, 3500);
  assert.equal(draft.input.components[0].gst_gross, 2000);
});
