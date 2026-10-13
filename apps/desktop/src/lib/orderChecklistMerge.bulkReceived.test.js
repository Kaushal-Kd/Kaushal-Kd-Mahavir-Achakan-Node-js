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

  it('loads Received as unticked when a missing line was previously marked received', () => {
    const order = {
      items: [],
      accessories: [
        {
          id: 'acc-partial',
          type: 'rent',
          qty: 2,
          missing: true,
          missing_qty: 1,
          stage_flags: { prepared: true, delivered: true, received: true },
        },
      ],
    };
    const draft = buildStageDraftMap(order);
    assert.equal(draft[checklistRowKey('accessory', 'acc-partial')].received, false);
  });

  it('skips Received when any missing quantity is selected on an accessory line', () => {
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
    assert.equal(next[checklistRowKey('accessory', 'acc-partial')].received, false);
  });
});
