import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS,
  ITEM_TO_PREPARE_PRINT_COLUMNS,
  buildPrepareBookingExportRows,
  buildPrepareProductExportRows,
  formatPreparePdfDesignDetails,
  formatPreparePdfLineDetails,
  formatPreparePdfProductNote,
  formatPreparePdfProductStatus,
} from './itemToPreparePdfExport.js';

const booking = {
  id: 'order-1',
  order_number: 'B-38',
  customer_phone: '9876543210',
  customer_whatsapp: '9123456780',
};

const lines = [
  {
    id: 'line-1',
    order_id: 'order-1',
    display_order: 1,
    product_code: 'P-101',
    product_name: 'Sherwani',
    qty: 1,
    line_type: 'rent',
    item_status_label: 'AVAILABLE',
    tailor_notes: 'Keep with cover',
    product_catalog_notes: 'Gold buttons',
    line_accessories: [
      {
        name_snapshot: 'Necklace',
        category_name: 'Jewellery',
        qty: 2,
        type: 'rent',
        given_status: 'given_with_rent',
      },
      {
        name_snapshot: 'Brooch',
        category_name: 'Jewellery',
        qty: 1,
        type: 'rent',
        given_status: 'regular',
      },
    ],
    order_extra_accessories: [
      {
        name_snapshot: 'Shoes',
        category_name: 'Footwear',
        qty: 1,
        type: 'rent',
        given_status: 'given_with_rent',
      },
    ],
  },
];

test('Prepare export keeps all accessories, product-specific notes, and conditional quantity', () => {
  const [row] = buildPrepareBookingExportRows([booking], lines);
  const text = formatPreparePdfLineDetails(row);
  assert.match(text, /Product 1: P-101 - Sherwani/);
  assert.doesNotMatch(text, /Qty 1/);
  assert.match(text, /Necklace, Qty 2, Given with rent/);
  assert.match(text, /Brooch/);
  assert.match(text, /Extra FOOTWEAR: Shoes, Given with rent/);
  assert.equal(formatPreparePdfDesignDetails(row), 'Gold buttons');
  assert.equal(formatPreparePdfProductNote(row), 'Keep with cover');
  assert.doesNotMatch(text, /Gold buttons|Keep with cover/);
  assert.doesNotMatch(text, /Rent|AVAILABLE/);
});

test('Prepare PDF places each product design and booking note in separate bordered columns', () => {
  const twoProducts = [lines[0], { ...lines[0], id: 'line-2', display_order: 2,
    product_code: 'P-102', product_catalog_notes: 'Silver embroidery', tailor_notes: 'Shorten sleeve' }];
  const rows = buildPrepareProductExportRows([booking], twoProducts);
  assert.equal(rows.length, 3);
  assert.equal(formatPreparePdfDesignDetails(rows[0]), 'Gold buttons');
  assert.equal(formatPreparePdfProductNote(rows[0]), 'Keep with cover');
  assert.equal(formatPreparePdfDesignDetails(rows[1]), 'Silver embroidery');
  assert.equal(formatPreparePdfProductNote(rows[1]), 'Shorten sleeve');
  assert.match(formatPreparePdfLineDetails(rows[1]), /Product 2: P-102/);
  assert.equal(formatPreparePdfProductStatus(rows[1]), 'AVAILABLE');
  assert.equal(formatPreparePdfProductNote(rows[2]), '');
  assert.equal(rows.filter((row) => row.order_extra_accessories.length).length, 1);
  assert.ok(rows.every((row) => row.order_number === booking.order_number));
  const design = ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS.find((column) => column.key === 'design_details');
  const note = ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS.find((column) => column.key === 'product_note');
  assert.equal(design.get(rows[0]), 'Gold buttons');
  assert.equal(note.get(rows[0]), 'Keep with cover');
  assert.ok(ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS.every((column) => !column.richGet));
  assert.ok(ITEM_TO_PREPARE_PRINT_COLUMNS.reduce((total, column) => total + column.width, 0) <= 277);
});

test('identical product notes remain associated with each product and empty designs stay empty', () => {
  const rows = buildPrepareProductExportRows([booking], [
    { ...lines[0], product_catalog_notes: '', order_extra_accessories: [] },
    { ...lines[0], id: 'line-2', product_code: 'P-102', order_extra_accessories: [] },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(formatPreparePdfDesignDetails(rows[0]), '');
  assert.deepEqual(rows.map(formatPreparePdfProductNote), ['Keep with cover', 'Keep with cover']);
});

test('long design details continue in bounded rows with the same product identity', () => {
  const design = 'Intricate gold embroidery. '.repeat(70).trim();
  const rows = buildPrepareProductExportRows([booking], [{ ...lines[0], product_catalog_notes: design,
    order_extra_accessories: [] }]);
  assert.ok(rows.length > 1);
  assert.equal(rows.map(formatPreparePdfDesignDetails).join(' '), design);
  assert.ok(rows.every((row) => formatPreparePdfDesignDetails(row).length <= 600));
  assert.ok(rows.every((row) => formatPreparePdfLineDetails(row).includes('P-101')));
  assert.match(formatPreparePdfLineDetails(rows[1]), /Continued/);
  assert.doesNotMatch(formatPreparePdfLineDetails(rows[1]), /Necklace/);
});

test('Prepare contact cell stacks distinct mobile and WhatsApp numbers', () => {
  const contact = ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS.find(
    (column) => column.key === 'customer_phone'
  );
  assert.equal(contact.get(booking), '9876543210\n9123456780');
  assert.equal(
    contact.get({ ...booking, customer_whatsapp: booking.customer_phone }),
    '9876543210'
  );
});

test('Prepare print status reports the live product status separately', () => {
  const [row] = buildPrepareBookingExportRows([booking], lines);
  assert.equal(formatPreparePdfProductStatus(row), 'P-101: AVAILABLE');
});

test('Prepare export retains accessory-only bills without inventing a product line', () => {
  const accessoryOnlyLine = {
    id: 'accessory-only:order-2',
    order_id: 'order-2',
    is_accessory_only: true,
    order_extra_accessories: [
      {
        name_snapshot: 'Pearl necklace',
        category_name: 'Jewellery',
        qty: 3,
        type: 'rent',
        given_status: 'regular',
      },
    ],
  };
  const [row] = buildPrepareProductExportRows(
    [{ ...booking, id: 'order-2', order_number: 'B-39' }],
    [accessoryOnlyLine]
  );

  assert.ok(row);
  assert.match(formatPreparePdfLineDetails(row), /Extra JEWELLERY: Pearl necklace, Qty 3/);
  assert.doesNotMatch(formatPreparePdfLineDetails(row), /Product:/);
  assert.equal(formatPreparePdfProductStatus(row), 'Accessories only');
});
