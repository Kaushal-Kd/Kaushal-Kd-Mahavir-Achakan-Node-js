import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accessoryConditionQuantity,
  requestedAccessoryConditionQuantity,
  accessoryUnavailableQuantity,
  accessoryWashableReturnQuantity,
  hasBlockingProductCondition,
  lineBlocksReceivedByMissingQuantity,
} from './returnConditionRules.js';

test('explicit accessory quantities are rejected instead of expanding zero or clamping oversized input', () => {
  for (const condition of ['damage', 'missing']) {
    for (const quantity of [0, -1, 4, 1.5, Infinity, NaN]) {
      assert.throws(() => requestedAccessoryConditionQuantity({ qty: 3 }, condition, quantity), {
        statusCode: 400,
      });
    }
    assert.equal(requestedAccessoryConditionQuantity({ qty: 3 }, condition, 1), 1);
    assert.equal(requestedAccessoryConditionQuantity({ qty: 3 }, condition, 3), 3);
  }
});

test('normal quantity is zero and omitted quantities retain legacy fallback behavior', () => {
  assert.equal(requestedAccessoryConditionQuantity({ qty: 3 }, 'normal', 0), 0);
  assert.throws(() => requestedAccessoryConditionQuantity({ qty: 3 }, 'normal', 1), {
    statusCode: 400,
  });
  assert.equal(requestedAccessoryConditionQuantity({ qty: 3, damaged_qty: 1 }, 'damage'), 1);
  assert.equal(requestedAccessoryConditionQuantity({ qty: 3 }, 'missing'), 3);
});

test('only the selected accessory quantity is marked unavailable', () => {
  const line = { qty: 3, damaged: true, damaged_qty: 1, missing_qty: 0 };
  assert.equal(accessoryConditionQuantity(line, 'damage', 1), 1);
  assert.equal(accessoryUnavailableQuantity(line), 1);
  assert.equal(accessoryWashableReturnQuantity(line), 2);
});

test('stale quantity columns do not hold stock after condition flags are cleared', () => {
  const line = { qty: 3, damaged: false, damaged_qty: 2, missing: false, missing_qty: 1 };
  assert.equal(accessoryUnavailableQuantity(line), 0);
  assert.equal(accessoryWashableReturnQuantity(line), 3);
});

test('partial missing quantities allow the remaining units to be received', () => {
  assert.equal(
    lineBlocksReceivedByMissingQuantity({ qty: 3, missing: true, missing_qty: 1 }),
    false
  );
  assert.equal(
    lineBlocksReceivedByMissingQuantity({ qty: 3, missing: true, missing_qty: 3 }),
    true
  );
});

test('damage does not block an order from reaching Returned, while missing does', () => {
  assert.equal(hasBlockingProductCondition([{ damaged: true, missing: false }]), false);
  assert.equal(hasBlockingProductCondition([{ damaged: true, missing: true }]), true);
});
