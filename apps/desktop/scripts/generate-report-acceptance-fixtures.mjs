import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildLaundrySlipPdfBlob } from '../src/utils/laundrySlipPdf.js';
import { buildTablePdfDoc } from '../src/utils/tablePdf.js';

const output = resolve('tmp/pdfs/2026-09-06');
mkdirSync(output, { recursive: true });
const pendingRows = Array.from({ length: 105 }, (_, index) => ({
  bill: `TEST-${index + 1}`,
  customer: `Synthetic customer ${index + 1}`,
  total: 1000,
  advance: 200,
  pending: 800,
  date: '06/09/2026',
}));
buildTablePdfDoc(
  [
    { key: 'bill', header: 'Bill No.' },
    { key: 'customer', header: 'Customer' },
    { key: 'total', header: 'Bill Amount' },
    { key: 'advance', header: 'Advance Amount' },
    { key: 'pending', header: 'Pending Amount' },
    { key: 'date', header: 'Return Date' },
  ],
  pendingRows,
  { title: 'Pending Bills Amounts', subtitle: 'Synthetic acceptance: all 105 records' }
).save(resolve(output, 'pending-bills.pdf'));

for (const [name, count, categoryCount, accessoryOnly] of [
  ['washing-single', 1, 1, false],
  ['washing-many', 120, 10, false],
  ['washing-large-category', 600, 1, false],
  ['washing-accessories', 0, 0, true],
]) {
  const productRows = Array.from({ length: count }, (_, index) => ({
    code: `P${String(index + 1).padStart(4, '0')}`,
    categoryId: `c${index % categoryCount}`,
    categoryLabel: `Category ${(index % categoryCount) + 1}`,
    qty: 1,
    priority: 'Medium',
  }));
  const categorySummaries = Array.from({ length: categoryCount }, (_, index) => ({
    key: `c${index}`,
    label: `Category ${index + 1}`,
    productCount: count / categoryCount,
    qtyTotal: count / categoryCount,
    washPrice: 10,
  }));
  const accessoryRows = accessoryOnly
    ? [{ categoryName: 'Jewellery', name: 'Jewellery', qty: 3, rate: 20 }]
    : [];
  const payable = count * 10 + (accessoryOnly ? 60 : 0);
  const blob = await buildLaundrySlipPdfBlob({
    jobNo: 'TEST-WASH',
    laundryDate: '2026-09-06',
    vendor: 'Synthetic vendor',
    pickupAt: '2026-09-06 10:30:00',
    returnAt: '2026-09-08 18:00:00',
    productRows,
    categorySummaries,
    accessoryRows,
    productTotal: count * 10,
    accessoryTotal: accessoryOnly ? 60 : 0,
    subtotal: payable,
    payable,
    remarks: 'Synthetic output only. No customer or vendor was contacted.',
    vendorOutstanding: {
      bills: [
        { jobNo: 'OLD-WASH', remaining: 100 },
        { jobNo: 'TEST-WASH', remaining: payable },
      ],
      totals: { billCount: 2, totalRemaining: payable + 100 },
    },
  });
  writeFileSync(resolve(output, `${name}.pdf`), Buffer.from(await blob.arrayBuffer()));
}
console.info(`Generated pending-bills and four washing PDF fixtures in ${output}`);

const longCode = 'TEST-LONG-PRODUCT-CODE-1234567890-END';
const longCategory = 'Premium embroidered wedding sherwani category';
const longBlob = await buildLaundrySlipPdfBlob({
  jobNo: 'TEST-LONG',
  laundryDate: '2026-09-06',
  vendor: 'Synthetic vendor',
  productRows: [
    { code: longCode, categoryId: 'long', categoryLabel: longCategory, qty: 1, priority: 'Urgent' },
  ],
  categorySummaries: [
    { key: 'long', label: longCategory, productCount: 1, qtyTotal: 1, washPrice: 10 },
  ],
  productTotal: 10,
  subtotal: 10,
  payable: 10,
});
writeFileSync(
  resolve(output, 'washing-long-labels.pdf'),
  Buffer.from(await longBlob.arrayBuffer())
);
