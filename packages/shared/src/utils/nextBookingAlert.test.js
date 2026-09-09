import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyNextBookingAlertsToItems,
  buildNextBookingAlert,
  earliestNextBookingPickupIsoFromAlerts,
  formatNextBookingAlertMessage,
  normalizeNextPickupDateToIso,
  shouldShowNextBookingAlert,
  uniqueNextBookingsFromAlerts,
} from './nextBookingAlert.js';

test('shouldShowNextBookingAlert hides received lines', () => {
  assert.equal(
    shouldShowNextBookingAlert({ received: true, gapDays: 1, thresholdDays: 2 }),
    false
  );
});

test('shouldShowNextBookingAlert hides when threshold is zero', () => {
  assert.equal(
    shouldShowNextBookingAlert({ received: false, gapDays: 0, thresholdDays: 0 }),
    false
  );
});

test('shouldShowNextBookingAlert shows when gap is within threshold', () => {
  assert.equal(
    shouldShowNextBookingAlert({ received: false, gapDays: 2, thresholdDays: 2 }),
    true
  );
  assert.equal(
    shouldShowNextBookingAlert({ received: false, gapDays: 1, thresholdDays: 2 }),
    true
  );
});

test('shouldShowNextBookingAlert hides when gap exceeds threshold', () => {
  assert.equal(
    shouldShowNextBookingAlert({ received: false, gapDays: 3, thresholdDays: 2 }),
    false
  );
});

test('buildNextBookingAlert returns payload only when eligible', () => {
  const nextBooking = {
    next_order_id: 'o2',
    next_order_number: '0910',
    next_pickup_date: '2026-05-16',
    gap_days: 2,
  };
  assert.deepEqual(buildNextBookingAlert(nextBooking, 2), {
    next_order_id: 'o2',
    next_order_number: '0910',
    next_pickup_date: '2026-05-16',
    gap_days: 2,
    threshold_days: 2,
  });
  assert.equal(buildNextBookingAlert(nextBooking, 1), null);
});

test('formatNextBookingAlertMessage includes booking number and gap', () => {
  const message = formatNextBookingAlertMessage({
    next_order_number: '0910',
    next_pickup_date: '2026-05-16',
    gap_days: 2,
  });
  assert.match(message, /0910/);
  assert.match(message, /2026-05-16/);
  assert.match(message, /2-day gap/);
});

test('formatNextBookingAlertMessage prefixes product label when provided', () => {
  const message = formatNextBookingAlertMessage(
    {
      next_order_number: '0910',
      next_pickup_date: '2026-05-16',
      gap_days: 2,
    },
    { productLabel: 'Sherwani' }
  );
  assert.match(message, /Sherwani/);
  assert.match(message, /0910/);
});

test('applyNextBookingAlertsToItems keeps earliest eligible alert and skips received lines', () => {
  const items = [
    {
      id: 'i1',
      type: 'rent',
      product_id: 'p1',
      stage_flags: { received: false },
    },
    {
      id: 'i2',
      type: 'rent',
      product_id: 'p2',
      stage_flags: { received: true },
    },
    {
      id: 'i3',
      type: 'sell',
      product_id: 'p3',
      stage_flags: { received: false },
    },
  ];
  const nextByProductId = new Map([
    [
      'p1',
      {
        next_order_id: 'o2',
        next_order_number: '0910',
        next_pickup_date: '2026-05-16',
        gap_days: 2,
      },
    ],
    [
      'p2',
      {
        next_order_id: 'o3',
        next_order_number: '0911',
        next_pickup_date: '2026-05-16',
        gap_days: 1,
      },
    ],
  ]);
  applyNextBookingAlertsToItems(items, nextByProductId, 2);
  assert.ok(items[0].next_booking_alert);
  assert.equal(items[0].next_booking_alert.next_order_number, '0910');
  assert.equal(items[1].next_booking_alert, null);
  assert.equal(items[2].next_booking_alert, null);
});

test('earliestNextBookingPickupIsoFromAlerts picks minimum ISO date', () => {
  assert.equal(earliestNextBookingPickupIsoFromAlerts(null), null);
  assert.equal(earliestNextBookingPickupIsoFromAlerts([]), null);
  assert.equal(
    earliestNextBookingPickupIsoFromAlerts([
      { next_pickup_date: '2026-06-10' },
      { next_pickup_date: '2026-06-01' },
      { next_pickup_date: '2026-06-05' },
    ]),
    '2026-06-01'
  );
});

test('normalizeNextPickupDateToIso handles Date objects and locale strings', () => {
  assert.equal(normalizeNextPickupDateToIso(null), null);
  assert.equal(normalizeNextPickupDateToIso('2026-05-16'), '2026-05-16');
  assert.equal(normalizeNextPickupDateToIso('2026-05-16T00:00:00.000Z'), '2026-05-16');
  assert.equal(normalizeNextPickupDateToIso('16-05-2026'), '2026-05-16');
  assert.equal(normalizeNextPickupDateToIso(new Date(2026, 4, 16)), '2026-05-16');
  assert.equal(
    earliestNextBookingPickupIsoFromAlerts([
      { next_pickup_date: new Date(2026, 5, 1) },
      { next_pickup_date: new Date(2026, 4, 20) },
    ]),
    '2026-05-20'
  );
});

test('uniqueNextBookingsFromAlerts dedupes and sorts by pickup date', () => {
  assert.deepEqual(uniqueNextBookingsFromAlerts(null), []);
  assert.deepEqual(uniqueNextBookingsFromAlerts([]), []);
  assert.deepEqual(
    uniqueNextBookingsFromAlerts([
      {
        next_order_id: 'o2',
        next_order_number: 'MAHAVIR-0038',
        next_pickup_date: '2026-07-15',
      },
      {
        next_order_id: 'o2',
        next_order_number: 'MAHAVIR-0038',
        next_pickup_date: '2026-07-15',
        name_snapshot: 'Dup product',
      },
      { next_order_number: 'MAHAVIR-0099', next_pickup_date: '2026-07-10' },
    ]),
    [
      {
        next_order_id: 'o2',
        next_order_number: 'MAHAVIR-0038',
        next_pickup_date: '2026-07-15',
      },
    ]
  );
  assert.deepEqual(
    uniqueNextBookingsFromAlerts([
      {
        next_order_id: 'o3',
        next_order_number: 'MAHAVIR-0040',
        next_pickup_date: '2026-07-20',
      },
      {
        next_order_id: 'o2',
        next_order_number: 'MAHAVIR-0038',
        next_pickup_date: '2026-07-15',
      },
    ]),
    [
      {
        next_order_id: 'o2',
        next_order_number: 'MAHAVIR-0038',
        next_pickup_date: '2026-07-15',
      },
      {
        next_order_id: 'o3',
        next_order_number: 'MAHAVIR-0040',
        next_pickup_date: '2026-07-20',
      },
    ]
  );
});
