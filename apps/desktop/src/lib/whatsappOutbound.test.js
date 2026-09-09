import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOrderWhatsappPhone } from './whatsappOutbound.js';

test('customer WhatsApp is preferred before primary/secondary contacts', () => {
  const customer = { whatsapp: '+91 90000 00001', phone1: '9000000002', phone2: '9000000003' };
  assert.equal(resolveOrderWhatsappPhone({ customer }), '9000000001');
  assert.equal(resolveOrderWhatsappPhone({ customer_whatsapp: '9000000004', customer }), '9000000004');
});

test('invalid or missing recipient values use the next complete contact, never truncated digits', () => {
  const customer = { whatsapp: '900000000123456', phone1: '9000000002', phone2: '9000000003' };
  assert.equal(resolveOrderWhatsappPhone({ customer }), '9000000002');
  assert.equal(resolveOrderWhatsappPhone({ customer_whatsapp: 'bad', customer: { ...customer, whatsapp: '9000000004' } }), '9000000004');
  assert.equal(resolveOrderWhatsappPhone({}, { phone1: 'bad', phone2: '9000000003' }), '9000000003');
  assert.equal(resolveOrderWhatsappPhone({ customer_whatsapp: '90000000012345' }), '');
});
