import assert from 'node:assert/strict';
import test from 'node:test';

import { ITEM_LINE_STATUS } from '../constants/itemLineStatus.js';
import { resolveItemLineWashingStatus } from './itemLineWashingStatus.js';

test('resolveItemLineWashingStatus returns null when no washing qty', () => {
  assert.equal(resolveItemLineWashingStatus({ washingQueueQty: 0, laundryWashingQty: 0 }), null);
  assert.equal(resolveItemLineWashingStatus(), null);
});

test('resolveItemLineWashingStatus returns washing_queue when only in queue', () => {
  const result = resolveItemLineWashingStatus({ washingQueueQty: 2, laundryWashingQty: 0 });
  assert.equal(result?.item_status, ITEM_LINE_STATUS.WASHING_QUEUE);
  assert.equal(result?.item_status_label, 'IN WASHING QUEUE');
});

test('resolveItemLineWashingStatus returns in_washing when only in laundry', () => {
  const result = resolveItemLineWashingStatus({ washingQueueQty: 0, laundryWashingQty: 1 });
  assert.equal(result?.item_status, ITEM_LINE_STATUS.IN_WASHING);
  assert.equal(result?.item_status_label, 'IN WASHING');
});

test('resolveItemLineWashingStatus returns combined label when both apply', () => {
  const result = resolveItemLineWashingStatus({ washingQueueQty: 1, laundryWashingQty: 2 });
  assert.equal(result?.item_status, ITEM_LINE_STATUS.WASHING_QUEUE);
  assert.equal(result?.item_status_label, 'IN WASHING QUEUE · IN WASHING');
});
