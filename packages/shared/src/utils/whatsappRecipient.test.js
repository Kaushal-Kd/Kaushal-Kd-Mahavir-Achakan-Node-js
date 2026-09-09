import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWhatsAppRecipient } from './whatsappRecipient.js';

test('WhatsApp recipients normalize explicit Indian local/country-prefix formatting only', () => {
  for (const value of ['9000000001', '+91 90000 00001', '919000000001', '09000000001', '(90000)-00001']) {
    assert.equal(normalizeWhatsAppRecipient(value), '9000000001', value);
  }
});

test('WhatsApp recipients reject malformed or overlong input instead of silently truncating', () => {
  for (const value of ['', null, '9000000001234', '90000000011', '+44 9000000001',
    '9000000001 ext 2', 'abc9000000001', '900000000', '90+00000001']) {
    assert.equal(normalizeWhatsAppRecipient(value), '', String(value));
  }
});
