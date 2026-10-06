import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveOrderContactAddress,
  resolveOrderContactPhone1,
  resolveOrderContactPhone2,
} from './orderCustomerSnapshot.js';

describe('resolveOrderContactPhone1', () => {
  it('prefers this booking snapshot over the shared customer master', () => {
    assert.equal(
      resolveOrderContactPhone1({
        contact_phone1: '9000000025',
        customer_phone: '9000000024',
        customer: { phone1: '9000000024' },
      }),
      '9000000025'
    );
  });

  it('falls back to master when this booking has no snapshot', () => {
    assert.equal(
      resolveOrderContactPhone1({
        customer_phone: '9000000024',
        customer: { phone1: '9000000024' },
      }),
      '9000000024'
    );
  });
});

describe('resolveOrderContactPhone2', () => {
  it('uses pickup_number from this booking', () => {
    assert.equal(
      resolveOrderContactPhone2({
        pickup_number: '9111111111',
        customer: { phone2: '9222222222' },
      }),
      '9111111111'
    );
  });
});

describe('resolveOrderContactAddress', () => {
  it('prefers this booking address', () => {
    assert.equal(
      resolveOrderContactAddress({
        contact_address: 'Bill 25 addr',
        customer_address: 'Shared addr',
      }),
      'Bill 25 addr'
    );
  });
});
