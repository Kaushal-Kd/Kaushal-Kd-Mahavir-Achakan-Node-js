import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assignMissingLineDisplayOrders, sortLinesForBookingTable } from './bookingAccessoryCart.js';

const product = (line_id, extra = {}) => ({ line_id, line_kind: 'product', type: 'rent', ...extra });

test('lines added one by one keep the order they were added', () => {
  let lines = [];
  for (const id of ['zz', 'aa', 'mm']) {
    lines = assignMissingLineDisplayOrders(lines, [...lines, product(id)]);
  }
  assert.deepEqual(
    sortLinesForBookingTable(lines).map((l) => l.line_id),
    ['zz', 'aa', 'mm']
  );
  assert.deepEqual(
    lines.map((l) => l.display_order),
    [0, 10, 20]
  );
});

test('hydrated lines that all have display_order 0 get array order', () => {
  const out = assignMissingLineDisplayOrders(
    [],
    [product('c', { display_order: 0 }), product('a', { display_order: 0 }), product('b', { display_order: 0 })]
  );
  assert.deepEqual(
    out.map((l) => l.display_order),
    [0, 10, 20]
  );
});

test('explicit positions and existing lines are left alone', () => {
  const prev = [product('a', { display_order: 0 }), product('b', { display_order: 10 })];
  const next = [...prev, product('pair', { display_order: 5 })];
  assert.equal(assignMissingLineDisplayOrders(prev, next), next);
});
