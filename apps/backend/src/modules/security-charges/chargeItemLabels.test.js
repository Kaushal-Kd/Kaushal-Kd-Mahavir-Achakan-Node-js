import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enrichChargeRowWithItemLabel,
  formatChecklistChargeRemarks,
  resolveChargeConditionKind,
  rewriteAmbiguousConditionRemarks,
} from './chargeItemLabels.js';

test('remarks stay on Missing or Damage, never Damage/missing', () => {
  assert.equal(
    formatChecklistChargeRemarks(null, 'accessory', 'PICH KASHMIRI', 'missing'),
    'Missing · PICH KASHMIRI'
  );
  assert.equal(
    formatChecklistChargeRemarks(null, 'item', 'ACHAKAN', 'damage'),
    'Damage · ACHAKAN'
  );
  assert.equal(
    formatChecklistChargeRemarks(
      'Damage/missing · Item: ACHAKAN',
      'item',
      'ACHAKAN',
      'missing'
    ),
    'Missing · ACHAKAN'
  );
  assert.doesNotMatch(
    formatChecklistChargeRemarks('Damage/missing - Accessory: DHAL', 'accessory', 'DHAL', null),
    /Damage\/missing/i
  );
});

test('legacy Damage/missing remarks take Missing or Damage from the order line', () => {
  const row = enrichChargeRowWithItemLabel(
    {
      item_type: 'accessory',
      item_id: 'a1',
      remarks: 'Damage/missing - Accessory: PICH KASHMIRI',
      condition_kind: null,
    },
    new Map([['accessory:a1', { label: 'PICH KASHMIRI', missing: true, damaged: false }]])
  );
  assert.equal(row.remarks, 'Missing · PICH KASHMIRI');
});

test('combined Damage/missing remarks drop the slash when kind is known', () => {
  assert.equal(
    rewriteAmbiguousConditionRemarks('Damage/missing · Combined charge', 'damage'),
    'Damage · Combined charge'
  );
  assert.equal(resolveChargeConditionKind(null, 'Missing - DHAL'), 'missing');
  assert.equal(resolveChargeConditionKind(null, 'Damage · MARUN CHANDERI'), 'damage');
  assert.equal(resolveChargeConditionKind(null, 'Damage/missing · Item: ACHAKAN'), null);
});
