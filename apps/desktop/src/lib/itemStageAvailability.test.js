import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checklistStageBlockedByAvailability,
  isAvailabilityGatedChecklistStage,
} from './itemStageAvailability.js';

test('delivery remains availability-gated together with collect and prepared', () => {
  assert.equal(isAvailabilityGatedChecklistStage('item_to_collect'), true);
  assert.equal(isAvailabilityGatedChecklistStage('prepared'), true);
  assert.equal(isAvailabilityGatedChecklistStage('delivered'), true);
  assert.equal(isAvailabilityGatedChecklistStage('received'), false);
});

test('unavailable products cannot be enabled for delivery', () => {
  const unavailable = { item_status: 'washing', item_available: false };
  assert.equal(
    checklistStageBlockedByAvailability('item', 'delivered', unavailable, true),
    true
  );
  assert.equal(
    checklistStageBlockedByAvailability('item', 'delivered', unavailable, false),
    false
  );
});
