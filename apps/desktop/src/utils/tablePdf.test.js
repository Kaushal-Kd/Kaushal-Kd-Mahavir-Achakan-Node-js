import assert from 'node:assert/strict';
import test from 'node:test';
import { jsPDF } from 'jspdf';

import {
  addPdfPageNumbers,
  buildPdfFooterRow,
  buildGroupedTablePdfDoc,
  buildTablePdfDoc,
} from './tablePdf.js';

function pdfOutput(doc) {
  return String(doc.output());
}

test('buildPdfFooterRow puts Total in the first non-money column', () => {
  assert.deepEqual(
    buildPdfFooterRow(
      [
        { key: 'order_number' },
        { key: 'customer_name' },
        { key: 'total_amount' },
        { key: 'balance' },
      ],
      { total_amount: '84,150', balance: '64,450' }
    ),
    ['Total', '', '84,150', '64,450']
  );
  assert.equal(buildPdfFooterRow([{ key: 'name' }], { total_amount: '1' }), null);
});

test('table PDF writes page X of Y on every page', () => {
  const columns = [
    { key: 'name', header: 'Name', get: (r) => r.name },
    { key: 'amount', header: 'Amt', get: (r) => r.amount },
  ];
  const rows = Array.from({ length: 80 }, (_, i) => ({ name: `Row ${i + 1}`, amount: String(i + 1) }));
  const doc = buildTablePdfDoc(columns, rows, { title: 'Pending Bills Amounts' });
  const pageCount = doc.getNumberOfPages();
  assert.ok(pageCount >= 2, 'expected a multi-page table PDF');
  const output = pdfOutput(doc);
  for (let i = 1; i <= pageCount; i += 1) {
    assert.match(output, new RegExp(`Page ${i} of ${pageCount}`));
  }
});

test('table PDF last page includes grand totals', () => {
  const columns = [
    { key: 'order_number', header: 'Bill No.', get: (r) => r.order_number },
    { key: 'total_amount', header: 'Bill Amt.', get: (r) => r.total_amount },
    { key: 'balance', header: 'Pending Amt.', get: (r) => r.balance },
  ];
  const doc = buildTablePdfDoc(columns, [{ order_number: 'MAHAVIR-0033', total_amount: '5,600', balance: '4,600' }], {
    title: 'Pending Bills Amounts',
    footerTotals: { total_amount: '5,600', balance: '4,600' },
    summary: [
      { label: 'Total Bill Amount', value: '5,600' },
      { label: 'Total Pending Amount', value: '4,600' },
    ],
  });
  const output = pdfOutput(doc);
  assert.match(output, /Page 1 of 1/);
  assert.match(output, /Total Bill Amount/);
  assert.match(output, /Total Pending Amount/);
  assert.match(output, /5,600/);
  assert.match(output, /4,600/);
});

test('grouped table PDF also numbers pages', () => {
  const columns = [{ key: 'name', header: 'Name', get: (r) => r.name }];
  const doc = buildGroupedTablePdfDoc(columns, [{ label: 'A', rows: [{ name: 'One' }] }], {
    title: 'Grouped',
  });
  assert.match(pdfOutput(doc), /Page 1 of 1/);
});

test('addPdfPageNumbers uses the final page count', () => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.text('first', 10, 10);
  doc.addPage();
  doc.text('second', 10, 10);
  addPdfPageNumbers(doc);
  const output = pdfOutput(doc);
  assert.match(output, /Page 1 of 2/);
  assert.match(output, /Page 2 of 2/);
});
