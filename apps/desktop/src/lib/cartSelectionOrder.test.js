import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sortCartLinesBySelectionOrder } from './cartSelectionOrder.js';

test('cart lines follow the order they were added, not newest first', () => {
  const cartNewestFirst = [
    { id: 'c', created_at: '2026-11-20T10:03:00Z', updated_at: '2026-11-20T10:09:00Z' },
    { id: 'b', created_at: '2026-11-20T10:02:00Z' },
    { id: 'a', created_at: '2026-11-20T10:01:00Z' },
  ];
  assert.deepEqual(
    sortCartLinesBySelectionOrder(cartNewestFirst).map((l) => l.id),
    ['a', 'b', 'c']
  );
});

test('same timestamp keeps the earlier-added line first', () => {
  const sameTime = '2026-11-20T10:00:00Z';
  const cartNewestFirst = [
    { id: 'second', created_at: sameTime },
    { id: 'first', created_at: sameTime },
  ];
  assert.deepEqual(
    sortCartLinesBySelectionOrder(cartNewestFirst).map((l) => l.id),
    ['first', 'second']
  );
});
