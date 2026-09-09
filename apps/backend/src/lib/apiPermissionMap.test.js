import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIONS, MODULES } from '@wrs/shared';

import { resolveApiAction, resolveApiModule } from './apiPermissionMap.js';

test('delivery settlement requires booking edit permission', () => {
  assert.equal(
    resolveApiAction('/api/orders/20c68b5f-e5de-44a7-9ca3-a8b31feee0a0/delivery-settlement', 'POST'),
    ACTIONS.EDIT
  );
});

test('return settlement requires booking edit permission', () => {
  assert.equal(
    resolveApiAction('/api/orders/20c68b5f-e5de-44a7-9ca3-a8b31feee0a0/return-settlement', 'POST'),
    ACTIONS.EDIT
  );
});

test('ordinary POST routes continue to require create permission', () => {
  assert.equal(resolveApiAction('/api/orders', 'POST'), ACTIONS.CREATE);
});

test('checklist command requires Booking Edit, not Create', () => {
  const path = '/api/orders/order-123/checklist-command';
  assert.equal(resolveApiModule(path), MODULES.BOOKING);
  assert.equal(resolveApiAction(path, 'POST'), ACTIONS.EDIT);
});

test('GST conversion requires reports approval permission', () => {
  const path = '/api/gst/order-123/convert-to-kaccha';
  assert.equal(resolveApiModule(path), MODULES.REPORTS);
  assert.equal(resolveApiAction(path, 'POST'), ACTIONS.APPROVE);
});

test('WhatsApp bill messages require booking print permission', () => {
  const path = '/api/whatsapp/messages/send';
  assert.equal(resolveApiModule(path), MODULES.BOOKING);
  assert.equal(resolveApiAction(path, 'POST'), ACTIONS.PRINT);
});
