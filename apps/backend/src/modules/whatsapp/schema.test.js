import assert from 'node:assert/strict';
import test from 'node:test';

import { sendWhatsAppMessageSchema } from './schema.js';
import { phoneToJid } from './service.js';

test('WhatsApp schema normalizes valid target and rejects truncation-prone recipients before send', () => {
  const base = { template_key: 'BILL_DELIVER' };
  assert.equal(sendWhatsAppMessageSchema.parse({ ...base, phone: '+91 90000 00001' }).phone, '9000000001');
  for (const phone of ['9000000001234', '90000000', '9000000001 ext2', '+44 9000000001']) {
    assert.equal(sendWhatsAppMessageSchema.safeParse({ ...base, phone }).success, false);
    assert.equal(phoneToJid(phone), null);
  }
  assert.equal(phoneToJid('+91 90000 00001'), '919000000001@s.whatsapp.net');
});
