import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { customOrderToBillOrder } from './customOrderBill.js';

describe('customOrderToBillOrder', () => {
  it('emits one bill line per custom-order product', () => {
    const bill = customOrderToBillOrder(
      {
        order_number: 'CO-1',
        customer_name: 'Asha',
        price: 1000,
        line_discount: 0,
        total_amount: 1000,
        subtotal: 1000,
        discount_total: 0,
        tax_total: 0,
        paid_amount: 0,
        balance: 1000,
        booking_discount_amount: 0,
        items: [
          { product_name: 'Sherwani', design_name: 'Royal', color: 'Maroon', size: '40' },
          { product_name: 'Jacket', color: 'Black' },
        ],
      },
      { categoryName: 'Achakan' }
    );
    assert.equal(bill.items.length, 2);
    assert.equal(bill.items[0].name_snapshot, 'Sherwani · Royal · Maroon · 40');
    assert.equal(bill.items[0].price, 1000);
    assert.equal(bill.items[1].name_snapshot, 'Jacket · Black');
    assert.equal(bill.items[1].price, 0);
  });
});
