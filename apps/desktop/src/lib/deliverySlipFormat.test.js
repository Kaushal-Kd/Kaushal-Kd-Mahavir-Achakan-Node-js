import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductTokenSlipFields,
  enrichSlipOrderForTokens,
} from './deliverySlipFormat.js';

test('enrichSlipOrderForTokens accepts a missing order and a null customer', () => {
  assert.equal(enrichSlipOrderForTokens(null).customer_phone, '');
  assert.equal(enrichSlipOrderForTokens(undefined).order_number, '');
  assert.equal(
    enrichSlipOrderForTokens({ order_number: 'B1', customer: null, pickup_number: '999' })
      .customer_phone,
    '999'
  );
});

test('enrichSlipOrderForTokens prefers this booking contact snapshot over the customer master', () => {
  assert.equal(
    enrichSlipOrderForTokens({
      contact_phone1: '9000000025',
      customer_phone: '9000000024',
      customer: { phone1: '9000000024' },
    }).customer_phone,
    '9000000025'
  );
});

test('product tokens show booking notes and exclude catalog remarks', () => {
  const fields = buildProductTokenSlipFields({
    id: 'order-1::item-1',
    order_number: 'BOOK-1',
    items: [
      {
        id: 'item-1',
        code_snapshot: 'P-2',
        name_snapshot: 'Marun sherwani',
        tailor_notes: 'Shorten sleeves',
        product_catalog_notes: 'Gold embroidery catalog remark',
      },
    ],
  });

  assert.equal(fields.find((field) => field.label === 'Notes')?.value, 'Shorten sleeves');
  assert.equal(fields.find((field) => field.label === 'Notes')?.valueBold, true);
  assert.equal(fields.find((field) => field.label === 'Name')?.value, 'Marun sherwani');
  assert.equal(fields.find((field) => field.key === 'code')?.valueBold, true);
  assert.equal(fields.find((field) => field.key === 'pickup')?.valueBold, true);
  assert.equal(fields.find((field) => field.key === 'return')?.valueBold, true);
  assert.equal(fields.find((field) => field.key === 'name')?.valueBold, undefined);
  assert.equal(
    fields.some((field) => field.label === 'Product remarks'),
    false
  );
  assert.equal(JSON.stringify(fields).includes('Gold embroidery catalog remark'), false);
});

test('product token field toggles hide code and still print the name', () => {
  const fields = buildProductTokenSlipFields(
    {
      order_number: 'BOOK-2',
      items: [{ id: 'item-2', code_snapshot: 'P-9', name_snapshot: 'Golden copper' }],
    },
    { product: { code: false, name: true, notes: false } }
  );

  assert.equal(
    fields.some((field) => field.key === 'code'),
    false
  );
  assert.equal(fields.find((field) => field.key === 'name')?.value, 'Golden copper');
  assert.equal(
    fields.some((field) => field.key === 'notes'),
    false
  );
});
