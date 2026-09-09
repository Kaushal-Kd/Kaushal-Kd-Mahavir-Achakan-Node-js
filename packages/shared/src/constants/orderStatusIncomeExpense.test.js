import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOOKED_PRODUCT_STATUS_BUCKETS,
  isOrderRentPaymentTransactionType,
  orderPaymentStatusBucketForFilter,
} from './orderStatus.js';
import {
  formatOrderPaymentBookingPart,
  formatOrderPaymentIncomeDetails,
  inferPaymentOrderStatusFromTimestamps,
  orderPaymentDisplayStatusForFilter,
  paymentOrderStatusForDisplay,
  resolvePaymentOrderStatus,
} from '../utils/orderPaymentReport.js';

describe('orderPaymentStatusBucketForFilter', () => {
  it('maps booked filter to pre-delivery statuses', () => {
    const bucket = orderPaymentStatusBucketForFilter('order_payment_booked');
    assert.deepEqual(bucket, [...BOOKED_PRODUCT_STATUS_BUCKETS.booked]);
    assert.ok(bucket.includes('booked'));
    assert.ok(!bucket.includes('delivered'));
  });

  it('maps delivered filter to delivered status only', () => {
    const bucket = orderPaymentStatusBucketForFilter('order_payment_delivered');
    assert.deepEqual(bucket, [...BOOKED_PRODUCT_STATUS_BUCKETS.delivered]);
    assert.deepEqual(bucket, ['delivered']);
  });

  it('maps returned filter to return pipeline statuses', () => {
    const bucket = orderPaymentStatusBucketForFilter('order_payment_returned');
    assert.deepEqual(bucket, [...BOOKED_PRODUCT_STATUS_BUCKETS.returned]);
    assert.ok(bucket.includes('returned'));
    assert.ok(bucket.includes('partially_returned'));
  });

  it('returns null for unrelated transaction types', () => {
    assert.equal(orderPaymentStatusBucketForFilter('booking_payment'), null);
    assert.equal(orderPaymentStatusBucketForFilter('sale_payment'), null);
    assert.equal(orderPaymentStatusBucketForFilter('all'), null);
  });
});

describe('isOrderRentPaymentTransactionType', () => {
  it('includes booking_payment and status bucket filters', () => {
    assert.equal(isOrderRentPaymentTransactionType('booking_payment'), true);
    assert.equal(isOrderRentPaymentTransactionType('order_payment_booked'), true);
    assert.equal(isOrderRentPaymentTransactionType('order_payment_delivered'), true);
    assert.equal(isOrderRentPaymentTransactionType('order_payment_returned'), true);
  });

  it('excludes sale and ledger types', () => {
    assert.equal(isOrderRentPaymentTransactionType('sale_payment'), false);
    assert.equal(isOrderRentPaymentTransactionType('income_entry'), false);
  });
});

describe('paymentOrderStatusForDisplay', () => {
  it('collapses pre-delivery statuses to booked', () => {
    assert.equal(paymentOrderStatusForDisplay('in_preparation'), 'booked');
    assert.equal(paymentOrderStatusForDisplay('booked'), 'booked');
  });

  it('treats ready_for_delivery as delivery phase for finance Details', () => {
    assert.equal(paymentOrderStatusForDisplay('ready_for_delivery'), 'delivered');
  });

  it('keeps delivered and returned buckets', () => {
    assert.equal(paymentOrderStatusForDisplay('delivered'), 'delivered');
    assert.equal(paymentOrderStatusForDisplay('returned'), 'returned');
  });
});

describe('inferPaymentOrderStatusFromTimestamps', () => {
  it('returns booked before delivery milestone', () => {
    assert.equal(
      inferPaymentOrderStatusFromTimestamps({
        created_at: '2026-06-20T07:13:00.000Z',
        delivered_at: '2026-07-09T10:49:00.000Z',
      }),
      'booked'
    );
  });

  it('returns delivered on or after delivery milestone', () => {
    assert.equal(
      inferPaymentOrderStatusFromTimestamps({
        created_at: '2026-07-09T10:49:00.000Z',
        delivered_at: '2026-07-09T10:49:00.000Z',
      }),
      'delivered'
    );
  });

  it('returns delivered on or after packed_at when delivered_at is not set yet', () => {
    assert.equal(
      inferPaymentOrderStatusFromTimestamps({
        created_at: '2026-07-11T07:14:00.000Z',
        packed_at: '2026-07-11T06:00:00.000Z',
      }),
      'delivered'
    );
  });
});

describe('resolvePaymentOrderStatus', () => {
  it('prefers immutable operation stage over all mutable order timestamps', () => {
    for (const [stage, expected] of [['booking', 'booked'], ['delivery', 'delivered'], ['return', 'returned']]) {
      assert.equal(resolvePaymentOrderStatus({
        payment_stage: stage,
        order_status_at_payment: 'delivered',
        created_at: '2026-09-05T10:00:00Z',
        order_delivered_at: '2026-09-01T10:00:00Z',
        order_returned_at: '2026-09-05T10:00:01Z',
        order_status: 'returned',
      }), expected);
    }
  });
  it('collapses stored pre-delivery status to booked', () => {
    assert.equal(
      resolvePaymentOrderStatus({ order_status_at_payment: 'in_preparation' }),
      'booked'
    );
  });

  it('prefers milestone timestamps over stored pre-delivery status', () => {
    assert.equal(
      resolvePaymentOrderStatus({
        order_status_at_payment: 'ready_for_delivery',
        created_at: '2026-07-09T10:49:00.000Z',
        delivered_at: '2026-07-09T10:49:00.000Z',
      }),
      'delivered'
    );
  });

  it('uses stored ready_for_delivery when no delivery milestone applies yet', () => {
    assert.equal(
      resolvePaymentOrderStatus({
        order_status_at_payment: 'ready_for_delivery',
        created_at: '2026-07-11T07:14:00.000Z',
      }),
      'delivered'
    );
  });

  it('does not use current order status when timestamps allow inference', () => {
    assert.equal(
      resolvePaymentOrderStatus({
        order_status: 'delivered',
        created_at: '2026-06-20T07:13:00.000Z',
        delivered_at: '2026-07-09T10:49:00.000Z',
      }),
      'booked'
    );
  });

  it('returns delivered for delivery-screen payment after packed_at', () => {
    assert.equal(
      resolvePaymentOrderStatus({
        order_status_at_payment: 'booked',
        created_at: '2026-07-11T07:14:00.000Z',
        packed_at: '2026-07-11T06:00:00.000Z',
      }),
      'delivered'
    );
  });

  it('ignores legacy backfill bucket stored on payment row', () => {
    assert.equal(
      resolvePaymentOrderStatus({
        order_status_at_payment: 'booked',
        created_at: '2026-07-11T07:14:00.000Z',
        order_status: 'delivered',
        is_follow_up_order_payment: true,
      }),
      'delivered'
    );
  });

  it('classifies follow-up payment on delivered order as delivered (MAHAVIR-0056 pattern)', () => {
    assert.equal(
      resolvePaymentOrderStatus({
        order_status_at_payment: 'booked',
        created_at: '2026-07-11T07:14:00.000Z',
        order_status: 'delivered',
        is_follow_up_order_payment: true,
      }),
      'delivered'
    );
    assert.equal(
      resolvePaymentOrderStatus({
        order_status_at_payment: 'booked',
        created_at: '2026-07-09T09:49:00.000Z',
        order_status: 'delivered',
        is_follow_up_order_payment: false,
      }),
      'booked'
    );
  });
});

describe('formatOrderPaymentIncomeDetails', () => {
  it('formats MAHAVIR-style advance vs delivery payments', () => {
    assert.equal(
      formatOrderPaymentIncomeDetails('MAHAVIR-0015', 'booked', null),
      'MAHAVIR-0015 - PAYMENT (BOOKING - Booked)'
    );
    assert.equal(
      formatOrderPaymentIncomeDetails('MAHAVIR-0015', 'delivered', null),
      'MAHAVIR-0015 - PAYMENT (BOOKING - Delivered)'
    );
  });
});

describe('orderPaymentDisplayStatusForFilter', () => {
  it('maps transaction types to display status keys', () => {
    assert.equal(orderPaymentDisplayStatusForFilter('order_payment_booked'), 'booked');
    assert.equal(orderPaymentDisplayStatusForFilter('order_payment_delivered'), 'delivered');
    assert.equal(orderPaymentDisplayStatusForFilter('order_payment_returned'), 'returned');
    assert.equal(orderPaymentDisplayStatusForFilter('booking_payment'), null);
  });
});

describe('formatOrderPaymentBookingPart', () => {
  it('returns bucket label', () => {
    assert.equal(formatOrderPaymentBookingPart('booked'), 'BOOKING - Booked');
    assert.equal(formatOrderPaymentBookingPart('delivered'), 'BOOKING - Delivered');
  });
});
