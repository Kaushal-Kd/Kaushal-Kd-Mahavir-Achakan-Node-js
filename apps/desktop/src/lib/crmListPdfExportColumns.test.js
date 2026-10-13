import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTableColumns } from './tableColumnPreferences.js';
import {
  CRM_LIST_PDF_EXPORT_DEFAULT_HIDDEN,
  DELIVERY_PDF_EXPORT_COLUMNS,
  formatDeliveryPdfLineDetails,
  formatPdfSecurityReference,
  formatPdfTotalRent,
} from './crmListPdfExportColumns.js';

test('delivery PDF catalog includes the requested handover columns in order', () => {
  assert.deepEqual(
    DELIVERY_PDF_EXPORT_COLUMNS.map((col) => col.key),
    [
      'order_number',
      'customer_address',
      'customer_name',
      'customer_phone',
      'pickup_date',
      'return_date',
      'delivery_datetime',
      'return_datetime',
      'line_details',
      'rent_total',
      'paid_amount',
      'balance',
      'security_reference',
    ]
  );
  const visible = applyTableColumns(DELIVERY_PDF_EXPORT_COLUMNS, {
    hiddenKeys: CRM_LIST_PDF_EXPORT_DEFAULT_HIDDEN,
  });
  assert.equal(visible.length, DELIVERY_PDF_EXPORT_COLUMNS.length);
  assert.ok(visible.reduce((total, col) => total + col.width, 0) <= 277);
});

test('delivery product & accessories lists each product and its accessories', () => {
  const text = formatDeliveryPdfLineDetails({
    items: [
      { id: 'i1', code_snapshot: 'FA-0016[36]', name_snapshot: 'JODHPURI', qty: 1, type: 'rent' },
      { id: 'i2', code_snapshot: 'FA-0015[34]', name_snapshot: 'ACHAKAN', qty: 1, type: 'rent' },
    ],
    accessories: [
      {
        order_item_id: 'i1',
        category_name: 'Safa',
        name_snapshot: 'Red safa',
        qty: 1,
        given_status: 'pack_with_rent',
      },
      {
        order_item_id: null,
        category_name: 'Mala',
        name_snapshot: 'Pearl mala',
        qty: 2,
        given_status: 'regular',
      },
    ],
  });
  assert.match(text, /Product 1: FA-0016\[36\] - JODHPURI/);
  assert.match(text, /SAFA: Red safa, Pack with rent/);
  assert.match(text, /Product 2: FA-0015\[34\] - ACHAKAN/);
  assert.match(text, /Extra MALA: Pearl mala, Qty 2/);
});

test('security / reference combines deposit status and reference name', () => {
  assert.equal(formatPdfSecurityReference({ deposit_amount: 0, reference_name: 'POTE' }), 'No deposit\nRef: POTE');
  assert.match(
    formatPdfSecurityReference({
      deposit_amount: 1000,
      paid_security_amt: true,
      reference_name: 'CALL',
    }),
    /1,000 \(Paid\)/
  );
  assert.equal(formatPdfTotalRent({ subtotal: 5000, discount_total: 500 }), '4,500');
});
