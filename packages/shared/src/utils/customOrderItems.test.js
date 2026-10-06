import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  customOrderItemsFromOrder,
  formatCustomOrderProductsLabel,
  nextUnlinkedCustomOrderItem,
  primaryCustomOrderItemFields,
} from './customOrderItems.js';

describe('customOrderItemsFromOrder', () => {
  it('uses saved items when present', () => {
    const items = customOrderItemsFromOrder({
      product_name: 'Parent',
      items: [
        { product_name: 'Sherwani', design_name: 'A' },
        { product_name: 'Jacket', design_name: 'B' },
      ],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].product_name, 'Sherwani');
    assert.equal(items[1].product_name, 'Jacket');
  });

  it('falls back to parent product columns', () => {
    const items = customOrderItemsFromOrder({
      design_name: 'Royal',
      product_name: 'Sherwani',
      color: 'Maroon',
      size: '40',
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].product_name, 'Sherwani');
    assert.equal(items[0].design_name, 'Royal');
  });
});

describe('primaryCustomOrderItemFields', () => {
  it('copies the first item onto parent columns', () => {
    const fields = primaryCustomOrderItemFields([
      { product_name: 'Sherwani', category_id: 'c1', color: 'Red' },
      { product_name: 'Jacket' },
    ]);
    assert.equal(fields.product_name, 'Sherwani');
    assert.equal(fields.category_id, 'c1');
    assert.equal(fields.color, 'Red');
  });
});

describe('formatCustomOrderProductsLabel', () => {
  it('joins product names', () => {
    const label = formatCustomOrderProductsLabel({
      items: [{ product_name: 'Sherwani' }, { design_name: 'Jacket design' }],
    });
    assert.equal(label, 'Sherwani, Jacket design');
  });
});

describe('nextUnlinkedCustomOrderItem', () => {
  it('skips already linked lines', () => {
    const next = nextUnlinkedCustomOrderItem({
      items: [
        { id: 'a', product_name: 'Sherwani', linked_product_id: 'p1' },
        { id: 'b', product_name: 'Jacket' },
      ],
    });
    assert.equal(next.id, 'b');
  });
});
