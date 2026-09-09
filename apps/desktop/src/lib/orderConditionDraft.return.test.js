import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyConditionPatchToDraft,
  buildConditionRemarksFromDraft,
  buildConditionDraftMap,
  buildReturnConditionUpdates,
} from './orderConditionDraft.js';

const order = {
  items: [
    {
      id: 'item-1',
      type: 'rent',
      damaged: true,
      missing: false,
      damage_charge: 900,
    },
  ],
  accessories: [],
};

test('Damage and Missing are mutually exclusive in the condition draft', () => {
  const initial = buildConditionDraftMap(order);
  const next = applyConditionPatchToDraft(initial, 'item', 'item-1', { missing: true });
  assert.equal(next['item:item-1'].missing, true);
  assert.equal(next['item:item-1'].damaged, false);
});

test('an already-saved damaged line is included when it is newly received', () => {
  const draft = buildConditionDraftMap(order);
  assert.deepEqual(
    buildReturnConditionUpdates(order, draft, [
      { item_id: 'item-1', item_type: 'item', field: 'received', value: true },
    ]),
    [
      {
        item_id: 'item-1',
        item_type: 'item',
        condition: 'damage',
        condition_qty: 1,
        charge_amount: 900,
      },
    ]
  );
});

test('condition remarks name only the selected status and affected quantity', () => {
  const accessoryOrder = {
    items: [],
    accessories: [
      { id: 'acc-1', name_snapshot: 'Necklace', qty: 3, missing: false, damaged: false },
    ],
  };
  const draft = buildConditionDraftMap(accessoryOrder);
  const changed = applyConditionPatchToDraft(draft, 'accessory', 'acc-1', {
    missing: true,
    condition_qty: 1,
  });
  const remarks = buildConditionRemarksFromDraft(accessoryOrder, changed);
  assert.match(remarks, /^Missing:/);
  assert.match(remarks, /Qty 1 of 3/);
  assert.doesNotMatch(remarks, /Damage\//);
});

test('condition-only return carries the original replacement version', () => {
  const current = {
    ...order,
    items: [{ ...order.items[0], product_id: 'replacement', replacement_version: 2 }],
  };
  const draft = applyConditionPatchToDraft(buildConditionDraftMap(current), 'item', 'item-1', {
    missing: true,
  });
  const [update] = buildReturnConditionUpdates(current, draft);
  assert.equal(update.expected_product_id, 'replacement');
  assert.equal(update.expected_line_version, 2);
});
