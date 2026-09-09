import assert from 'node:assert/strict';
import test from 'node:test';

import { applyConditionPatchWithStageEffects } from './orderChecklistMerge.js';

test('new product Damage defaults to catalog selling price times quantity', () => {
  const order = {
    items: [{ id: 'item-1', qty: 2, catalog_price_sell: 5000 }],
    accessories: [],
  };
  const conditionDraft = {
    'item:item-1': { missing: false, damaged: false, damage_charge: 0 },
  };

  const result = applyConditionPatchWithStageEffects(order, {}, conditionDraft, 'item', 'item-1', {
    damaged: true,
  });

  assert.equal(result.conditionDraft['item:item-1'].damaged, true);
  assert.equal(result.conditionDraft['item:item-1'].damage_charge, 10000);
});

test('new accessory Damage defaults to catalog selling price times quantity', () => {
  const order = {
    items: [],
    accessories: [{ id: 'accessory-1', qty: 3, catalog_price_sell: 700 }],
  };
  const conditionDraft = {
    'accessory:accessory-1': { missing: false, damaged: false, damage_charge: 0 },
  };

  const result = applyConditionPatchWithStageEffects(
    order,
    {},
    conditionDraft,
    'accessory',
    'accessory-1',
    { damaged: true }
  );

  assert.equal(result.conditionDraft['accessory:accessory-1'].damaged, true);
  assert.equal(result.conditionDraft['accessory:accessory-1'].damage_charge, 2100);
});

test('selected accessory damage quantity defaults the charge and auto-selects Received', () => {
  const order = {
    items: [],
    accessories: [
      {
        id: 'accessory-1',
        qty: 3,
        catalog_price_sell: 700,
        stage_flags: { prepared: true, delivered: true, received: false },
      },
    ],
  };
  const conditionDraft = {
    'accessory:accessory-1': {
      missing: false,
      damaged: false,
      condition_qty: 0,
      damage_charge: 0,
    },
  };
  const stageDraft = {
    'accessory:accessory-1': { prepared: true, delivered: true, received: false },
  };

  const result = applyConditionPatchWithStageEffects(
    order,
    stageDraft,
    conditionDraft,
    'accessory',
    'accessory-1',
    { damaged: true, condition_qty: 1 }
  );

  assert.equal(result.conditionDraft['accessory:accessory-1'].condition_qty, 1);
  assert.equal(result.conditionDraft['accessory:accessory-1'].damage_charge, 700);
  assert.equal(result.stageDraft['accessory:accessory-1'].received, true);
});
