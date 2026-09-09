import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ITEM_LINE_STATUS } from '@wrs/shared';

import { resolveLineAvailability } from './itemLineAvailability.js';

function emptySnap(totalQty = 1, conflicts = []) {
  return {
    total_qty: totalQty,
    washing_qty: 0,
    washing_queue_qty: 0,
    laundry_washing_qty: 0,
    conflicts,
    washing_queue: [],
    laundry_washing: [],
  };
}

function pendingSibling({ order_item_id, order_id, pickup_date, return_date, qty = 1, order_number }) {
  return {
    order_item_id,
    order_id,
    pickup_date,
    return_date,
    qty,
    order_number,
    customer_name: 'Test Customer',
    order_status: 'booked',
    flags: { item_to_collect: false, prepared: false, delivered: false, received: false },
    stage_kind: 'pending',
  };
}

function collectedSibling({ order_item_id, order_id, pickup_date, qty = 1, order_number }) {
  return {
    order_item_id,
    order_id,
    pickup_date,
    return_date: pickup_date,
    qty,
    order_number,
    customer_name: 'Test Customer',
    order_status: 'booked',
    flags: { item_to_collect: true, prepared: false, delivered: false, received: false },
    stage_kind: 'collected',
  };
}

function deliveredSibling({ order_item_id, order_id, pickup_date, qty = 1, order_number }) {
  return {
    order_item_id,
    order_id,
    pickup_date,
    return_date: pickup_date,
    qty,
    order_number,
    customer_name: 'Test Customer',
    order_status: 'delivered',
    flags: { item_to_collect: true, prepared: true, delivered: true, received: false },
    stage_kind: 'delivered',
  };
}

function lineRow({ id, order_id, pickup_date, return_date, qty = 1 }) {
  return { id, order_id, pickup_date, return_date, qty };
}

function gapConflict({
  order_item_id,
  order_id,
  pickup_date,
  return_date,
  booked_qty = 1,
  order_number,
  previous_booking_gap_days = 5,
}) {
  return {
    order_item_id,
    order_id,
    order_number,
    status: 'booked',
    pickup_date,
    return_date,
    booked_qty,
    customer_name: 'Other Customer',
    next_booking_gap_days: 0,
    previous_booking_gap_days,
  };
}

describe('resolveLineAvailability — pickup-date collection queue', () => {
  it('earliest pending pickup is AVAILABLE; later pending is PREVIOUSLY BOOKED (Jul 25 vs Jul 30)', () => {
    const snap = emptySnap(1, [
      gapConflict({
        order_item_id: 'item-30',
        order_id: 'order-30',
        order_number: 'MAHAVIR-20260724138',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
      gapConflict({
        order_item_id: 'item-25',
        order_id: 'order-25',
        order_number: 'MAHAVIR-2026072196',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
    ]);

    const siblings = [
      pendingSibling({
        order_item_id: 'item-25',
        order_id: 'order-25',
        order_number: 'MAHAVIR-2026072196',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
      pendingSibling({
        order_item_id: 'item-30',
        order_id: 'order-30',
        order_number: 'MAHAVIR-20260724138',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
    ];

    const earlier = resolveLineAvailability(
      lineRow({
        id: 'item-25',
        order_id: 'order-25',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
      snap,
      siblings
    );

    const later = resolveLineAvailability(
      lineRow({
        id: 'item-30',
        order_id: 'order-30',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
      snap,
      siblings
    );

    assert.equal(earlier.item_status, ITEM_LINE_STATUS.AVAILABLE);
    assert.equal(earlier.item_available, true);
    assert.equal(later.item_status, ITEM_LINE_STATUS.BOOKED_ELSEWHERE);
    assert.equal(later.item_available, false);
  });

  it('after earliest line is collected, later line shows PREVIOUSLY COLLECTED', () => {
    const snap = emptySnap(1, []);

    const siblings = [
      collectedSibling({
        order_item_id: 'item-25',
        order_id: 'order-25',
        order_number: 'MAHAVIR-2026072196',
        pickup_date: '2026-07-25',
      }),
      pendingSibling({
        order_item_id: 'item-30',
        order_id: 'order-30',
        order_number: 'MAHAVIR-20260724138',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
    ];

    const later = resolveLineAvailability(
      lineRow({
        id: 'item-30',
        order_id: 'order-30',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
      snap,
      siblings
    );

    assert.equal(later.item_status, ITEM_LINE_STATUS.COLLECTED_ELSEWHERE);
    assert.equal(later.item_available, false);
  });

  it('qty=2 allows both pending lines to be AVAILABLE', () => {
    const snap = emptySnap(2, []);

    const siblings = [
      pendingSibling({
        order_item_id: 'item-25',
        order_id: 'order-25',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
      pendingSibling({
        order_item_id: 'item-30',
        order_id: 'order-30',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
    ];

    const earlier = resolveLineAvailability(
      lineRow({
        id: 'item-25',
        order_id: 'order-25',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
      snap,
      siblings
    );

    const later = resolveLineAvailability(
      lineRow({
        id: 'item-30',
        order_id: 'order-30',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
      }),
      snap,
      siblings
    );

    assert.equal(earlier.item_status, ITEM_LINE_STATUS.AVAILABLE);
    assert.equal(later.item_status, ITEM_LINE_STATUS.AVAILABLE);
  });

  it('delivered peer blocks earlier pending line as WITH CUSTOMER', () => {
    const snap = emptySnap(1, [
      {
        order_item_id: 'item-30',
        order_id: 'order-30',
        order_number: 'MAHAVIR-LATER',
        status: 'delivered',
        pickup_date: '2026-07-30',
        return_date: '2026-08-02',
        booked_qty: 1,
        customer_name: 'Later Customer',
      },
    ]);

    const siblings = [
      pendingSibling({
        order_item_id: 'item-25',
        order_id: 'order-25',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
      deliveredSibling({
        order_item_id: 'item-30',
        order_id: 'order-30',
        order_number: 'MAHAVIR-LATER',
        pickup_date: '2026-07-30',
      }),
    ];

    const earlier = resolveLineAvailability(
      lineRow({
        id: 'item-25',
        order_id: 'order-25',
        pickup_date: '2026-07-25',
        return_date: '2026-07-28',
      }),
      snap,
      siblings
    );

    assert.equal(earlier.item_status, ITEM_LINE_STATUS.WITH_CUSTOMER);
    assert.equal(earlier.item_available, false);
  });
});
