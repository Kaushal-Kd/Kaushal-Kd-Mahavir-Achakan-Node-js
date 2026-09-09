import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIONS, defaultPermissionsByRole, MODULES } from '../constants/permissions.js';
import {
  buildWhatsAppContextFromOrder,
  renderWhatsAppTemplate,
} from '../utils/whatsappTemplateRender.js';

import { authSessionListQuerySchema, revokeAuthSessionSchema } from './auth.js';
import {
  cashReconciliationBodySchema,
  gstConversionBodySchema,
  gstReportQuerySchema,
  whatsappResendSchema,
} from './financeAdmin.js';

test('cash reconciliation validates its date and movement fingerprint', () => {
  const result = cashReconciliationBodySchema.safeParse({
    payment_account_id: 'floor-one-cash',
    business_date: '2026-08-18',
    counted_closing: 1250.5,
    idempotency_key: 'cash-close-0001',
    expected_total_fingerprint: 'a'.repeat(64),
  });
  assert.equal(result.success, true);
  assert.equal(
    cashReconciliationBodySchema.safeParse({
      payment_account_id: 'floor-one-cash',
      business_date: '18-08-2026',
      counted_closing: 0,
      idempotency_key: 'cash-close-0001',
      expected_total_fingerprint: 'short',
    }).success,
    false
  );
});

test('GST report rejects a reversed range and conversion requires a reason', () => {
  assert.equal(
    gstReportQuerySchema.safeParse({
      source: 'booking',
      from: '2026-08-18',
      to: '2026-08-20',
      per_page: 500,
    }).success,
    true
  );
  assert.equal(
    gstReportQuerySchema.safeParse({ source: 'booking', from: '2026-08-20', to: '2026-08-18' })
      .success,
    false
  );
  assert.equal(
    gstConversionBodySchema.safeParse({
      source_type: 'sale',
      idempotency_key: 'convert-0001',
      reason: '  ',
    }).success,
    false
  );
});

test('Manager defaults include operations but exclude destructive administration', () => {
  const manager = defaultPermissionsByRole().manager;
  assert.equal(manager[MODULES.BOOKING][ACTIONS.APPROVE], true);
  assert.equal(manager[MODULES.REPORTS][ACTIONS.EXPORT], true);
  assert.notEqual(manager[MODULES.BOOKING][ACTIONS.DELETE], true);
  assert.equal(manager[MODULES.SETTINGS], undefined);
  assert.equal(manager[MODULES.USERS], undefined);
  assert.equal(manager[MODULES.SHOPS], undefined);
});

test('device-session schemas restrict status and require a revocation reason', () => {
  assert.equal(authSessionListQuerySchema.parse({}).status, 'active');
  assert.equal(authSessionListQuerySchema.safeParse({ status: 'unknown' }).success, false);
  assert.equal(revokeAuthSessionSchema.safeParse({ reason: '' }).success, false);
});

test('WhatsApp delivery and missing variables render from separate context fields', () => {
  const context = buildWhatsAppContextFromOrder(
    {
      order_number: 'B-0042',
      pickup_date: '2026-08-20',
      delivery_time: '10:30 AM',
      delivered_items: 'Sherwani × 1',
      missing_items: 'Turban × 1',
      damage_items: 'Shoes × 1',
      missing_charges: 500,
      damage_charges: 250,
    },
    {},
    { name: 'Test Customer', address: 'Main Road' }
  );
  const rendered = renderWhatsAppTemplate(
    '*{BILL_NO}* | *{DELIVERY_DATE}* | *{DELIVERED_ITEMS}* | *{MISSING_ITEMS}* | *{DAMAGE_ITEMS}* | *{MISSING_CHARGES}* | *{DAMAGE_CHARGES}*',
    context
  );
  assert.equal(
    rendered,
    'B-0042 | 2026-08-20 | Sherwani × 1 | Turban × 1 | Shoes × 1 | 500 | 250'
  );
});

test('WhatsApp transaction resend requires the PDF payload', () => {
  const base = {
    template_key: 'DELIVERY_PRODUCT_LIST',
    order_id: '20c68b5f-e5de-44a7-9ca3-a8b31feee0a0',
  };
  assert.equal(whatsappResendSchema.safeParse(base).success, false);
  assert.equal(
    whatsappResendSchema.safeParse({
      ...base,
      document: { filename: 'delivery.pdf', content_base64: 'cGRm' },
    }).success,
    true
  );
});
