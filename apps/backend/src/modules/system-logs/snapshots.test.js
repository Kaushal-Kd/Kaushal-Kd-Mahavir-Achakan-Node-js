import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBookingBillSnapshot, buildBookingProductSnapshot } from './snapshots.js';
import { normalizeSnapshotForDiff } from './normalizeSnapshot.js';

describe('buildBookingBillSnapshot', () => {
  it('stores customer phone1 in snapshot', () => {
    const snap = buildBookingBillSnapshot(
      { id: 'o1', order_number: 'MAHAVIR-0007' },
      { id: 'c1', name: 'Test', phone1: '9876543210', address: 'KUKDA 2' }
    );
    assert.equal(snap.customer.phone1, '9876543210');
    assert.equal(snap.customer.phone, '9876543210');
    assert.equal(snap.customer.address, 'KUKDA 2');
  });
});

describe('buildBookingProductSnapshot', () => {
  it('maps price to rent and effective order salesman', () => {
    const order = {
      sales_person_id: 'sp-order',
      items: [
        {
          id: 'line-1',
          product_id: 'p1',
          code_snapshot: 'P-1',
          name_snapshot: 'Shirt',
          qty: 1,
          price: 500,
          discount: 0,
          type: 'rent',
          stage_flags: { prepared: false, delivered: false, received: false, item_to_collect: false },
        },
      ],
      accessories: [],
    };
    const snap = buildBookingProductSnapshot(order, { order });
    assert.equal(snap.items[0].rent, 500);
    assert.equal(snap.items[0].sales_person_id, 'sp-order');
    assert.equal(snap.items[0].sales_person_name, undefined);
  });
});

describe('normalizeSnapshotForDiff booking product', () => {
  it('treats order-level salesman same as line-level for diff', () => {
    const prev = normalizeSnapshotForDiff('booking', 'product', {
      _order_sales_person_id: 'sp-1',
      _stage_only: false,
      items: [
        {
          id: 'line-1',
          product_id: 'p1',
          name_snapshot: 'Shirt',
          qty: 1,
          rent: 500,
          sales_person_id: null,
          stage_flags: { prepared: false, delivered: false, received: false, item_to_collect: false },
        },
      ],
      accessories: [],
    });
    const next = normalizeSnapshotForDiff('booking', 'product', {
      _order_sales_person_id: 'sp-1',
      _stage_only: false,
      items: [
        {
          id: 'line-1',
          product_id: 'p1',
          name_snapshot: 'Shirt',
          qty: 1,
          price: 500,
          sales_person_id: 'sp-1',
          stage_flags: { prepared: false, delivered: false, received: false, item_to_collect: false },
        },
      ],
      accessories: [],
    });
    assert.deepEqual(prev.items[0].sales_person_id, next.items[0].sales_person_id);
    assert.equal(prev.items[0].rent, next.items[0].rent);
  });
});
