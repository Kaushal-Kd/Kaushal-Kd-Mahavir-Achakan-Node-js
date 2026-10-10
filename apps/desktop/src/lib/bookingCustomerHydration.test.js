import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyBookingContactToCustomerForm,
  bookingCustomerContactSummary,
  buildBookingContactForCustomerEdit,
  emptyCustomerPatchFromBookingContact,
  hydrateBookingCustomerFields,
  inferWhatsappSource,
  normalizeWhatsappSource,
  restoreWhatsappFromDraftSnapshot,
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
    assert.equal(result.contactNo2, '9444444444');
    assert.equal(result.address, 'Order addr');
  });

  it('ignores another booking snapshot when a different customer is selected', () => {
    const result = hydrateBookingCustomerFields(
      { id: 'c2', phone1: '9000000002', address: 'New customer' },
      {
        customer_id: 'c1',
        contact_phone1: '9000000025',
        contact_address: 'Bill 25 addr',
      }
    );
    assert.equal(result.contactNo1, '9000000002');
    assert.equal(result.address, 'New customer');
  });

  it('keeps each booking snapshot when two bills share one customer', () => {
    const shared = { id: 'c1', phone1: '9000000024', address: 'Shared addr' };
    const bill25 = hydrateBookingCustomerFields(shared, {
      customer_id: 'c1',
      contact_phone1: '9000000025',
      contact_address: 'Bill 25 addr',
    });
    const bill24 = hydrateBookingCustomerFields(shared, {
      customer_id: 'c1',
      contact_phone1: '9000000024',
      contact_address: 'Bill 24 addr',
    });
    assert.equal(bill25.contactNo1, '9000000025');
    assert.equal(bill24.contactNo1, '9000000024');
    assert.equal(bill25.address, 'Bill 25 addr');
    assert.equal(bill24.address, 'Bill 24 addr');
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

describe('booking contact → Edit Customer', () => {
  it('carries booking phones into the customer form when master is empty', () => {
    const booking = buildBookingContactForCustomerEdit({
      contactNo1: '8785456788',
      contactNo2: '7657665650',
      contact2Name: 'Father',
      contactNo2SameAsPhone1: false,
      address: 'Halvad',
      whatsappSource: 'phone1',
    });
    assert.equal(booking.phone1, '8785456788');
    assert.equal(booking.phone2, '7657665650');
    const form = applyBookingContactToCustomerForm(
      { name: 'sddds', phone1: '', phone2: '', address: '' },
      booking
    );
    assert.equal(form.phone1, '8785456788');
    assert.equal(form.phone2, '7657665650');
    assert.equal(form.address, 'Halvad');
  });

  it('patches only empty customer-master phones', () => {
    const booking = { phone1: '8785456788', phone2: '7657665650', address: 'Halvad' };
    const patch = emptyCustomerPatchFromBookingContact(
      { id: 'c1', name: 'sddds', phone1: '', phone2: '', address: '' },
      booking
    );
    assert.equal(patch.phone1, '8785456788');
    assert.equal(patch.phone2, '7657665650');
    assert.equal(
      emptyCustomerPatchFromBookingContact(
        { id: 'c1', phone1: '9000000001', phone2: '', address: 'Keep' },
        booking
      ).phone1,
      undefined
    );
  });
});

describe('bookingCustomerContactSummary', () => {
  it('returns em dash placeholders when empty', () => {
    const summary = bookingCustomerContactSummary({}, {});
    assert.equal(summary.contactNo1, '—');
    assert.equal(summary.address, '—');
  });
});

describe('restoreWhatsappFromDraftSnapshot', () => {
  it('keeps Same as Contact 1 even when master whatsapp looks like Other', () => {
    const restored = restoreWhatsappFromDraftSnapshot(
      {
        whatsappSource: 'phone1',
        contactNo1: '0123456789',
        whatsappManual: '0123456789',
      },
      { phone1: '0123456789', whatsapp: '9999999999' }
    );
    assert.equal(restored.source, 'phone1');
  });

  it('maps legacy other to manual', () => {
    assert.equal(normalizeWhatsappSource('other'), 'manual');
    const restored = restoreWhatsappFromDraftSnapshot({ whatsapp_source: 'other' }, null);
    assert.equal(restored.source, 'manual');
  });

  it('does not infer Other when snapshot source is missing and numbers match phone1', () => {
    const restored = restoreWhatsappFromDraftSnapshot(
      { contactNo1: '0123456789', whatsappManual: '0123456789' },
      { phone1: '', whatsapp: '0123456789' }
    );
    assert.equal(restored.source, 'phone1');
  });

  it('infers Other only when the number matches neither contact', () => {
    assert.equal(
      inferWhatsappSource({ phone1: '1111111111', phone2: '2222222222', whatsapp: '3333333333' }),
      'manual'
    );
  });
});
