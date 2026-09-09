import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveReturnStatus } from './securityDueService.js';

test('due security status stays Delivered before any valid receipt', () => {
  assert.equal(
    deriveReturnStatus({ rent_line_count: 2, received_line_count: 0, delivered_line_count: 2 }),
    'delivered'
  );
});

test('due security status distinguishes partial and completed returns', () => {
  assert.equal(
    deriveReturnStatus({ rent_line_count: 2, received_line_count: 1, delivered_line_count: 2 }),
    'partially_returned'
  );
  assert.equal(
    deriveReturnStatus({ rent_line_count: 2, received_line_count: 2, delivered_line_count: 2 }),
    'returned'
  );
});

test('physical return units take priority over a misleading returned header', () => {
  assert.equal(deriveReturnStatus({ rent_line_count: 3, received_line_count: 2, delivered_line_count: 3, order_status: 'returned' }), 'partially_returned');
  assert.equal(deriveReturnStatus({ rent_line_count: 3, received_line_count: 0, delivered_line_count: 0, order_status: 'returned' }), 'booked');
  assert.equal(deriveReturnStatus({ rent_line_count: 3, received_line_count: 3, delivered_line_count: 3, order_status: 'cancelled' }), 'cancelled');
});
