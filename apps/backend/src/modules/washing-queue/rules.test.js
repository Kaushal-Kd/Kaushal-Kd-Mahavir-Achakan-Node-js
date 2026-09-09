import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldQueueAccessoryForWashing } from './rules.js';

test('queues only accessories whose category is marked washable', () => {
  assert.equal(shouldQueueAccessoryForWashing({ id: 'a1', is_washable: true }), true);
  assert.equal(shouldQueueAccessoryForWashing({ id: 'a1', is_washable: false }), false);
  assert.equal(shouldQueueAccessoryForWashing({ id: 'a1', is_washable: null }), false);
  assert.equal(shouldQueueAccessoryForWashing(null), false);
});
