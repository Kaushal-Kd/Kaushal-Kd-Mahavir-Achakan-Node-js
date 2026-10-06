import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nowDatetimeLocal, splitDatetimeLocal } from '@wrs/shared';

import {
  bookingDateTimeForConvert,
  buildCustomOrderBookingHandoff,
} from './customOrderBookingHandoffPayload.js';

describe('convert-to-booking date', () => {
  it('stamps the conversion clock, not the custom order date', () => {
    const converted = bookingDateTimeForConvert();
    const today = splitDatetimeLocal(nowDatetimeLocal()).date;
    assert.equal(splitDatetimeLocal(converted).date, today);
    assert.match(converted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('does not copy custom-order order_date onto the booking handoff', () => {
    const handoff = buildCustomOrderBookingHandoff({
      id: 'co-1',
      order_date: '2026-09-01',
      order_time: '10:00',
      customer_name: 'Amitbhai',
      customer_phone: '9000000025',
      delivery_date: '2026-11-01',
      return_date: '2026-11-03',
      linked_product_id: 'p-1',
    });
    assert.equal(handoff.order_date, undefined);
    assert.equal(handoff.booking_date, undefined);
    assert.equal(handoff.bookingDateTime, undefined);
    assert.equal(handoff.delivery_date, '2026-11-01');
  });
});
