import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookingAlertRowClass,
  damageReplacementsForRow,
  rowHasDamageReplacement,
} from './damageReplacementAlert.js';

test('product-wise rows highlight only the damaged product line', () => {
  const order = {
    has_damage_replacement: true,
    damage_replacements: [{ target_order_item_id: 'item-1', source_product_label: 'A-12' }],
  };
  const affected = { ...order, product_item_id: 'item-1' };
  const other = { ...order, product_item_id: 'item-2' };
  assert.equal(rowHasDamageReplacement(affected), true);
  assert.equal(rowHasDamageReplacement(other), false);
  assert.equal(damageReplacementsForRow(affected).length, 1);
  assert.match(bookingAlertRowClass(affected), /damage-replacement-row/);
  assert.equal(bookingAlertRowClass(other, 'booking-gap-alert-row'), 'booking-gap-alert-row');
});

test('order-level booking rows stay red until every replacement is done', () => {
  const row = {
    id: 'order-1',
    has_damage_replacement: true,
    damage_replacement_count: 2,
    damage_replacements: [
      { target_order_item_id: 'a', source_product_label: 'A-12' },
      { target_order_item_id: 'b', source_product_label: 'B-9' },
    ],
  };
  assert.equal(rowHasDamageReplacement(row), true);
  assert.equal(damageReplacementsForRow(row).length, 2);
});
