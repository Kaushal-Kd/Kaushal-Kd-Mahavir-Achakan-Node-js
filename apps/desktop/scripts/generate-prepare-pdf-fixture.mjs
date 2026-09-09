import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildPrepareProductExportRows, ITEM_TO_PREPARE_PRINT_COLUMNS } from '../src/lib/itemToPreparePdfExport.js';
import { buildTablePdfDoc } from '../src/utils/tablePdf.js';

const booking = { id: 'synthetic-order', order_number: 'TEST-38', customer_name: 'Synthetic customer',
  customer_address: 'Test address', customer_phone: '9876543210', customer_whatsapp: '9123456780',
  customer_notes: 'Booking-level note', pickup_date: '2026-09-06', return_date: '2026-09-08' };
const products = Array.from({ length: 20 }, (_, index) => ({
  id: `line-${index}`, order_id: booking.id, display_order: index,
  product_code: `P-${String(index + 1).padStart(3, '0')}`, product_name: 'Synthetic sherwani',
  qty: 1, product_catalog_notes: `Design ${index + 1}: Gold embroidery and covered buttons.`,
  tailor_notes: `Product note ${index + 1}: Shorten the left sleeve by one inch.`,
  item_status_label: 'AVAILABLE',
  line_accessories: [{ name_snapshot: 'Necklace', category_name: 'Jewellery', qty: 2 }],
  order_extra_accessories: [{ name_snapshot: 'Shoes', category_name: 'Footwear', qty: 1 }],
}));
const accessoryBooking = { ...booking, id: 'accessories-only', order_number: 'TEST-39' };
products.push({ order_id: accessoryBooking.id, is_accessory_only: true,
  order_extra_accessories: [{ name_snapshot: 'Crown', category_name: 'Headwear', qty: 3 }] });
products[18].product_catalog_notes = 'Intricate gold embroidery. '.repeat(70).trim();
const rows = buildPrepareProductExportRows([booking, accessoryBooking], products);
const doc = buildTablePdfDoc(ITEM_TO_PREPARE_PRINT_COLUMNS, rows, {
  title: 'Prepare Item - synthetic verification fixture', rowPageBreak: 'avoid',
});
const outputDir = resolve('tmp/pdfs');
mkdirSync(outputDir, { recursive: true });
const output = resolve(outputDir, 'prepare-verification.pdf');
doc.save(output);
console.info(`Generated ${doc.getNumberOfPages()} pages: ${output}`);
