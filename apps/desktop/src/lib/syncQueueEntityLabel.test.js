import assert from 'node:assert/strict';
import test from 'node:test';

import { getSyncQueueBlockMessage, getSyncQueueEntityLabel } from './syncQueueEntityLabel.js';

test('each supported queued operation has its own accurate user-facing label', () => {
  const expected = {
    delivery_settlement: 'Delivery settlement',
    return_settlement: 'Return settlement',
    security_charge_operation: 'Condition funds operation',
    order_item_replacement: 'Product replacement',
    order_edit: 'Booking edit',
    checklist_command: 'Checklist update',
    salesman_reassignment: 'Salesman work transfer',
    cash_reconciliation: 'Cash counter reconciliation',
    gst_conversion: 'GST to Kaccha conversion',
  };
  for (const [entity, label] of Object.entries(expected)) {
    assert.equal(getSyncQueueEntityLabel(entity), label);
  }
});

test('unknown or missing queued action is never mislabeled as a delivery settlement', () => {
  for (const entity of [
    undefined,
    null,
    '',
    'unknown_future_operation',
    'constructor',
    '__proto__',
  ]) {
    assert.equal(getSyncQueueEntityLabel(entity), 'Unrecognized saved action - review required');
  }
});

test('blocked actions explain their dependency until the earlier action is resolved', () => {
  assert.equal(
    getSyncQueueBlockMessage({
      blockedBy: 'return-1',
      blockedReason: 'Return must sync before delivery.',
    }),
    'Return must sync before delivery.'
  );
  assert.equal(
    getSyncQueueBlockMessage({ blockedBy: 'return-1' }),
    'An earlier saved action must be resolved first.'
  );
  assert.equal(getSyncQueueBlockMessage({ blockedBy: null, blockedReason: 'Old reason' }), null);
  assert.equal(getSyncQueueBlockMessage(undefined), null);
});
