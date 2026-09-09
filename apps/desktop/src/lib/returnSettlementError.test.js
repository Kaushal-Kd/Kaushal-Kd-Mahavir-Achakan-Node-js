import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyReturnSettlementError } from './returnSettlementError.js';

test('return settlement distinguishes network, temporary, server, and business errors', () => {
  assert.deepEqual(classifyReturnSettlementError(new Error('offline')), {
    refreshBooking: true,
    message: 'Connection error. Refresh and check the booking before trying again.',
  });
  assert.match(
    classifyReturnSettlementError({ response: { status: 429 } }).message,
    /Temporary server error/
  );
  assert.match(
    classifyReturnSettlementError({ response: { status: 500 } }).message,
    /Server error while saving the return/
  );
  assert.deepEqual(
    classifyReturnSettlementError({
      response: { status: 409, data: { error: { message: 'Accessory is unavailable' } } },
    }),
    { refreshBooking: false, message: 'Accessory is unavailable' }
  );
});

test('return settlement preserves a safe backend message for server errors', () => {
  assert.equal(
    classifyReturnSettlementError({
      response: { status: 500, data: { error: { message: 'Internal server error' } } },
    }).message,
    'Internal server error'
  );
});
