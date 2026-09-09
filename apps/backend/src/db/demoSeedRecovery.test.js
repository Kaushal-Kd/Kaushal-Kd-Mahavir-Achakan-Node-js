import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRentOrderPayload,
  resolveDemoProductStoredCode,
} from '../../scripts/seed-shop-demo-data.js';

test('demo booking payload explicitly remains non-GST without shop GST configuration', () => {
  const payload = buildRentOrderPayload({
    customer: { id: 'customer-1', name: 'Demo Customer', phone1: '9999999999' },
    product: { id: 'product-1', name: 'Demo Product', price_rent: 2500 },
    bookingDate: '2026-09-05',
    pickupDate: '2026-09-06',
    returnDate: '2026-09-07',
  });

  assert.equal(payload.bill_type, 'kaccha');
  assert.equal(payload.gst_enabled, false);
});

test('demo seed recovery looks up the normalized size-qualified product code', () => {
  assert.equal(resolveDemoProductStoredCode('DEMO-P-001', 'M'), 'DEMO-P-001[M]');
  assert.equal(resolveDemoProductStoredCode('DEMO-P-001[M]', 'M'), 'DEMO-P-001[M]');
});
