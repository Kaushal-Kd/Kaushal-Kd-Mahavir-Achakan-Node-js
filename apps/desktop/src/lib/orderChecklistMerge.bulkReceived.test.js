import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyBulkStageTrueToDraft,
  buildStageDraftMap,
  checklistRowKey,
} from './orderChecklistMerge.js';

const deliveredFlags = {
  item_to_collect: true,
  prepared: true,
  delivered: true,
  received: false,
};

const deliveredAccessoryFlags = {
  prepared: true,
  delivered: true,
  received: false,
};

describe('applyBulkStageTrueToDraft received', () => {
  it('marks product and linked accessory received in one call', () => {
    const order = {
      items: [
        {
          id: 'item-1',
          type: 'rent',
          stage_flags: deliveredFlags,
        },
      ],
      accessories: [
        {
          id: 'acc-1',
          type: 'rent',
          order_item_id: 'item-1',
          stage_flags: deliveredAccessoryFlags,
        },
      ],
    };

    const draft = buildStageDraftMap(order);
    const next = applyBulkStageTrueToDraft(draft, 'received', order);

    assert.equal(next[checklistRowKey('accessory', 'acc-1')].received, true);
    assert.equal(next[checklistRowKey('item', 'item-1')].received, true);
  });

  it('skips missing lines and still receives eligible linked lines', () => {
    const order = {
      items: [
        {
          id: 'item-1',
          type: 'rent',
          stage_flags: deliveredFlags,
        },
      ],
      accessories: [
        {
          id: 'acc-ok',
          type: 'rent',
          order_item_id: 'item-1',
          stage_flags: deliveredAccessoryFlags,
        },
        {
          id: 'acc-miss',
          type: 'rent',
          order_item_id: 'item-1',
          missing: true,
          stage_flags: deliveredAccessoryFlags,
        },
      ],
    };

    const draft = buildStageDraftMap(order);
    const next = applyBulkStageTrueToDraft(draft, 'received', order);

    assert.equal(next[checklistRowKey('accessory', 'acc-ok')].received, true);
    assert.equal(next[checklistRowKey('accessory', 'acc-miss')].received, false);
    assert.equal(next[checklistRowKey('item', 'item-1')].received, false);
  });

  it('receives the remaining units when only part of an accessory line is missing', () => {
    const order = {
      items: [],
      accessories: [
        {
          id: 'acc-partial',
          type: 'rent',
          qty: 3,
          missing: true,
          missing_qty: 1,
          stage_flags: deliveredAccessoryFlags,
        },
      ],
    };
    const draft = buildStageDraftMap(order);
    const next = applyBulkStageTrueToDraft(draft, 'received', order);
    assert.equal(next[checklistRowKey('accessory', 'acc-partial')].received, true);
  });
});
