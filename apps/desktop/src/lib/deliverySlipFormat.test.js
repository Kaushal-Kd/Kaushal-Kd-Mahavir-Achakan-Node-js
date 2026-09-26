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

test('product tokens show booking notes and exclude catalog remarks', () => {
  const fields = buildProductTokenSlipFields({
    id: 'order-1::item-1',
    order_number: 'BOOK-1',
    items: [
      {
        id: 'item-1',
        code_snapshot: 'P-2',
        tailor_notes: 'Shorten sleeves',
        product_catalog_notes: 'Gold embroidery catalog remark',
      },
    ],
  });

  assert.equal(fields.find((field) => field.label === 'Notes')?.value, 'Shorten sleeves');
  assert.equal(
    fields.some((field) => field.label === 'Product remarks'),
    false
  );
  assert.equal(JSON.stringify(fields).includes('Gold embroidery catalog remark'), false);
});
