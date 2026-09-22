import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDamageReplacementSummary,
  applyDamageReplacementSummaryToLines,
  groupDamageReplacementsByTargetOrder,
} from './attachSummary.js';

test('all later bookings for a damaged product are grouped as damage-affected', () => {
  const byOrder = groupDamageReplacementsByTargetOrder([
    {
      id: 'r1',
      target_order_id: 'later-a',
      target_order_item_id: 'item-a',
      source_product_label: 'A-12',
      customer_phone: '9999999999',
    },
    {
      id: 'r2',
      target_order_id: 'later-b',
      target_order_item_id: 'item-b',
      source_product_label: 'A-12',
      customer_phone: '8888888888',
    },
  ]);
  assert.equal(byOrder.get('later-a').length, 1);
  assert.equal(byOrder.get('later-b').length, 1);
  const orders = [{ id: 'later-a' }, { id: 'later-b' }, { id: 'unaffected' }];
  applyDamageReplacementSummary(orders, byOrder);
  assert.equal(orders[0].has_damage_replacement, true);
  assert.equal(orders[1].has_damage_replacement, true);
  assert.equal(orders[2].has_damage_replacement, false);
});

test('product line lists flag only the damaged-affected line', () => {
  const byOrder = groupDamageReplacementsByTargetOrder([
    {
      id: 'r1',
      target_order_id: 'order-1',
      target_order_item_id: 'item-damaged',
      source_product_label: 'A-12',
    },
  ]);
  const rows = [
    { id: 'item-damaged', order_id: 'order-1' },
    { id: 'item-ok', order_id: 'order-1' },
  ];
  applyDamageReplacementSummaryToLines(rows, byOrder);
  assert.equal(rows[0].line_has_damage_replacement, true);
  assert.equal(rows[1].line_has_damage_replacement, false);
  assert.equal(rows[0].has_damage_replacement, true);
  assert.equal(rows[1].has_damage_replacement, true);
});
