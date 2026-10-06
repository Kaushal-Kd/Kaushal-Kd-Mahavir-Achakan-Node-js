import assert from 'node:assert/strict';
import test from 'node:test';

import { isCompletedHandoverStage, stageFromOrderStatus } from './orderListStage.js';

test('handover is complete once delivered or moved past delivery', () => {
  for (const status of ['booked', 'item_to_collect', 'in_preparation', 'ready_for_delivery']) {
    assert.equal(isCompletedHandoverStage(status), false, status);
  }
  for (const status of ['delivered', 'partially_returned', 'received', 'returned', 'closed']) {
    assert.equal(isCompletedHandoverStage(status), true, status);
  }
  assert.equal(isCompletedHandoverStage('cancelled'), false);
});

test('received and returned map to the received stage', () => {
  assert.equal(stageFromOrderStatus('returned'), 'received');
  assert.equal(stageFromOrderStatus('delivered'), 'delivered');
});
