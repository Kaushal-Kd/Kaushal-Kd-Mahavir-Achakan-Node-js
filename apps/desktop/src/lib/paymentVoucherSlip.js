import { formatCurrency } from '@wrs/shared';

import { downloadHtmlAsPdf } from '../utils/billPdf.js';
import { renderAndPrint } from '../utils/printBill.js';

import { formatFinancialRecordDateTime } from './listTimestampColumns.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function billRef(row) {
  if (row.bill_kind === 'purchase' && row.purchase_bill_number) {
    return `Purchase · ${row.purchase_bill_number}`;
  }
  if (row.bill_kind === 'washing' && row.washing_bill_number) {
    return `Washing · ${row.washing_bill_number}`;
  }
  if (row.bill_kind === 'purchase') return 'Purchase';
  if (row.bill_kind === 'washing') return 'Washing';
  return '—';
}

/** @param {Record<string, unknown>} row */
export function buildPaymentVoucherSlipHtml(row) {
  const dateText = formatFinancialRecordDateTime(row, 'entry_date');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(row.voucher_number)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; color: #0C6EE1; }
    .meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td { padding: 8px 0; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    td.label { width: 38%; color: #6b7280; }
    td.value { font-weight: 600; text-align: right; }
    .amount { font-size: 18px; color: #0C6EE1; }
    .remarks { margin-top: 16px; font-size: 12px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Payment Voucher</h1>
  <div class="meta">${esc(row.voucher_number || '')} · ${esc(dateText || '')}</div>
  <table>
    <tr><td class="label">Credited account</td><td class="value">${esc(row.credit_account_name || '—')}</td></tr>
    <tr><td class="label">Debited account</td><td class="value">${esc(row.debit_account_name || '—')}</td></tr>
    <tr><td class="label">Bill</td><td class="value">${esc(billRef(row))}</td></tr>
    <tr><td class="label">Amount</td><td class="value amount">${esc(formatCurrency(row.amount))}</td></tr>
  </table>
  ${row.remarks ? `<div class="remarks"><strong>Remarks</strong><br />${esc(row.remarks)}</div>` : ''}
</body>
</html>`;
}

/** @param {Record<string, unknown>} row */
export async function printPaymentVoucher(row) {
  renderAndPrint(buildPaymentVoucherSlipHtml(row), {
    title: `Payment Voucher ${row.voucher_number || ''}`,
  });
}

/** @param {Record<string, unknown>} row */
export async function downloadPaymentVoucher(row) {
  const filename = `${String(row.voucher_number || 'payment-voucher').replace(/[^\w-]+/g, '_')}.pdf`;
  await downloadHtmlAsPdf(buildPaymentVoucherSlipHtml(row), filename);
}
