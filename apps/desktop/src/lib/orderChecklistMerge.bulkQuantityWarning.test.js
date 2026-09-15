import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getBulkAccessoryQuantityWarnings } from './orderChecklistMerge.js';

describe('bulk accessory quantity warning', () => {
  const order = {
    accessories: [
      { id: 'a1', qty: 3, code_snapshot: 'A-1', name_snapshot: 'Buttons' },
      { id: 'a2', qty: 1, code_snapshot: 'A-2', name_snapshot: 'Belt' },
    ],
  };

  it('lists multi-quantity accessories newly affected by bulk Prepare or Deliver', () => {
    const before = {
      'accessory:a1': { prepared: false, delivered: false },
      'accessory:a2': { prepared: false, delivered: false },
    };
    const after = {
      'accessory:a1': { prepared: true, delivered: false },
      'accessory:a2': { prepared: true, delivered: false },
    };
    assert.deepEqual(getBulkAccessoryQuantityWarnings(order, before, after, 'prepared'), [
      { id: 'a1', qty: 3, label: 'A-1 — Buttons' },
    ]);
  });

  it('does not warn for unrelated stages or already checked rows', () => {
    const draft = {
      'accessory:a1': { prepared: true, delivered: false },
      'accessory:a2': { prepared: true, delivered: false },
    };
    assert.deepEqual(getBulkAccessoryQuantityWarnings(order, draft, draft, 'prepared'), []);
    assert.deepEqual(getBulkAccessoryQuantityWarnings(order, draft, draft, 'received'), []);
  });
});
