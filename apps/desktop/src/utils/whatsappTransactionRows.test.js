import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWhatsAppTransactionPdf } from './whatsappTransactionPdf.js';
import {
  buildWhatsAppTransactionRows,
  deliveredLineKeysFromStageUpdates,
  newDeliveredLineKeys,
  newMissingLineKeys,
} from './whatsappTransactionRows.js';

test('delivery PDF rows contain only newly selected lines and show accessory categories', () => {
  const order = {
    items: [
      {
        id: 'product-1',
        product_id: 'p1',
        name_snapshot: 'Sherwani',
        qty: 1,
        stage_flags: { delivered: true },
      },
      {
        id: 'product-2',
        product_id: 'p2',
        name_snapshot: 'Suit',
        qty: 1,
        stage_flags: { delivered: true },
      },
    ],
    accessories: [
      {
        id: 'accessory-1',
        accessory_id: 'a1',
        name_snapshot: 'Red Safa',
        category_name: 'Safa',
        qty: 2,
        stage_flags: { delivered: true },
      },
    ],
  };
  const lineKeys = deliveredLineKeysFromStageUpdates([
    { item_type: 'item', item_id: 'product-2', field: 'delivered', value: true },
    {
      item_type: 'accessory',
      item_id: 'accessory-1',
      field: 'delivered',
      value: true,
    },
  ]);
  const rows = buildWhatsAppTransactionRows(order, 'delivery', { lineKeys });
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Suit', 'Red Safa']
  );
  assert.equal(rows[1].category, 'Safa');
});

test('missing PDF rows use only the affected accessory quantity', () => {
  const before = {
    accessories: [{ id: 'a1', accessory_id: 'catalog-a1', qty: 3, missing: false }],
  };
  const after = {
    accessories: [
      {
        id: 'a1',
        accessory_id: 'catalog-a1',
        name_snapshot: 'Button Set',
        category_name: 'Buttons',
        qty: 3,
        missing: true,
        missing_qty: 1,
      },
    ],
  };
  const lineKeys = newMissingLineKeys(before, after);
  const rows = buildWhatsAppTransactionRows(after, 'missing', { lineKeys });
  assert.deepEqual(lineKeys, ['accessory:a1']);
  assert.equal(rows[0].qty, 1);
  assert.equal(rows[0].category, 'Buttons');
});

test('delivery transaction PDF renders a non-empty document', () => {
  const pdf = buildWhatsAppTransactionPdf(
    {
      order_number: 'BK-001',
      pickup_name: 'Customer',
      accessories: [
        {
          id: 'a1',
          accessory_id: 'catalog-a1',
          name_snapshot: 'Red Safa',
          category_name: 'Safa',
          qty: 1,
          stage_flags: { delivered: true },
        },
      ],
    },
    'delivery',
    { lineKeys: ['accessory:a1'] }
  );
  assert.equal(pdf.mimetype, 'application/pdf');
  assert.match(pdf.filename, /^delivery-items-/);
  assert.ok(pdf.content_base64.length > 500);
});

test('an explicitly empty selection never expands to the whole delivered or missing bill', () => {
  const order = { items: [{ id: 'p1', qty: 1, missing: true, stage_flags: { delivered: true } }] };
  for (const kind of ['delivery', 'missing']) {
    assert.deepEqual(buildWhatsAppTransactionRows(order, kind, { lineKeys: [] }), []);
    assert.equal(buildWhatsAppTransactionRows(order, kind).length, 1);
  }
});

test('historical accessory with deleted catalog remains an accessory with affected quantity', () => {
  const order = { accessories: [{ id: 'a1', accessory_id: null, qty: 3,
    missing: true, missing_qty: 1, damaged: true, damaged_qty: 1,
    stage_flags: { delivered: true }, category_name: 'Buttons' }] };
  const [row] = buildWhatsAppTransactionRows(order, 'missing', { lineKeys: ['accessory:a1'] });
  assert.equal(row.type, 'Accessory');
  assert.equal(row.qty, 1);
  assert.equal(row.status, 'Missing');
  assert.equal(row.category, 'Buttons');
});

test('new delivered keys require a requested and confirmed false-to-true transition', () => {
  const before = { items: [
    { id: 'p1', stage_flags: { delivered: false } },
    { id: 'p2', stage_flags: { delivered: true } },
    { id: 'p3', stage_flags: { delivered: false } },
  ] };
  const after = { items: [
    { id: 'p1', stage_flags: '{"delivered":true}' },
    { id: 'p2', stage_flags: { delivered: true } },
    { id: 'p3', stage_flags: { delivered: false } },
    { id: 'p4', stage_flags: { delivered: true } },
  ] };
  const updates = ['p1', 'p1', 'p2', 'p3', 'p4'].map((item_id) => ({
    item_type: 'item', item_id, field: 'delivered', value: true,
  }));
  assert.deepEqual(newDeliveredLineKeys(before, after, updates), ['item:p1']);
  assert.deepEqual(newDeliveredLineKeys(before, after, []), []);
});
