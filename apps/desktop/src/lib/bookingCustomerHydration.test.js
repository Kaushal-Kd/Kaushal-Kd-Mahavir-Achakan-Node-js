import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bookingCustomerContactSummary,
  hydrateBookingCustomerFields,
} from './bookingCustomerHydration.js';

describe('hydrateBookingCustomerFields', () => {
  it('uses order snapshot when customer master is empty', () => {
    const result = hydrateBookingCustomerFields(
      { id: 'c1', name: 'VIJAYSINH', phone1: '', address: '', whatsapp: '7778901400' },
      {
        contact_phone1: '9876543210',
        contact_address: 'KUKDA 2',
        pickup_number: '9979100777',
      }
    );
    assert.equal(result.contactNo1, '9876543210');
    assert.equal(result.contactNo2, '9979100777');
    assert.equal(result.address, 'KUKDA 2');
  });

  it('prefers order snapshot over customer when both present', () => {
    const result = hydrateBookingCustomerFields(
      { phone1: '9111111111', phone2: '9222222222', address: 'Old addr' },
      { contact_phone1: '9333333333', contact_address: 'Order addr', pickup_number: '9444444444' }
    );
    assert.equal(result.contactNo1, '9333333333');
    assert.equal(result.contactNo2, '9222222222');
    assert.equal(result.address, 'Order addr');
  });

  it('falls back to customer when order snapshot missing', () => {
    const result = hydrateBookingCustomerFields(
      { phone1: '9876543210', phone2: '9123456789', address: 'Customer addr' },
      null
    );
    assert.equal(result.contactNo1, '9876543210');
    assert.equal(result.contactNo2, '9123456789');
    assert.equal(result.address, 'Customer addr');
  });
});

describe('bookingCustomerContactSummary', () => {
  it('returns em dash placeholders when empty', () => {
    const summary = bookingCustomerContactSummary({}, {});
    assert.equal(summary.contactNo1, '—');
    assert.equal(summary.address, '—');
  });
});
