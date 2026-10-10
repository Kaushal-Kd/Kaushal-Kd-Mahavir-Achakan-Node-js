import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookingTokenPrintIconClassName,
  hasTokenPrintStamp,
  isBookingTokenFullyPrinted,
  orderHasPackAccessoryTokenLines,
  stampTokenPrintedLocally,
} from './bookingTokenPrintStatus.js';

test('unprinted bookings stay red until every applicable token type is printed', () => {
  const both = {
    product_qty: 1,
    has_pack_accessory_token: 1,
  };
  assert.equal(isBookingTokenFullyPrinted(both), false);
  assert.match(bookingTokenPrintIconClassName(both), /text-red-600/);

  const productOnly = {
    ...both,
    product_token_printed_at: '2026-10-09T10:00:00.000Z',
  };
  assert.equal(isBookingTokenFullyPrinted(productOnly), false);

  const bothPrinted = {
    ...productOnly,
    accessory_token_printed_at: '2026-10-09T10:05:00.000Z',
  };
  assert.equal(isBookingTokenFullyPrinted(bothPrinted), true);
  assert.match(bookingTokenPrintIconClassName(bothPrinted), /text-brand/);
});

test('product-only bookings turn blue after product tokens print', () => {
  const row = { product_qty: 2, has_pack_accessory_token: 0, accessory_qty: 4 };
  assert.equal(isBookingTokenFullyPrinted(row), false);
  assert.equal(
    isBookingTokenFullyPrinted({ ...row, product_token_printed_at: '2026-10-09T12:00:00.000Z' }),
    true
  );
});

test('accessory-only bookings turn blue after accessory tokens print', () => {
  const row = {
    product_qty: 0,
    has_pack_accessory_token: true,
    accessories: [{ given_status: 'pack_with_rent' }],
  };
  assert.equal(isBookingTokenFullyPrinted(row), false);
  assert.equal(
    isBookingTokenFullyPrinted({ ...row, accessory_token_printed_at: new Date() }),
    true
  );
});

test('only pack-with-rent accessories count as printable tokens', () => {
  assert.equal(orderHasPackAccessoryTokenLines({ accessory_qty: 4, has_pack_accessory_token: 0 }), false);
  assert.equal(
    orderHasPackAccessoryTokenLines({ accessories: [{ given_status: 'given_with_rent' }] }),
    false
  );
  assert.equal(orderHasPackAccessoryTokenLines({ has_pack_accessory_token: 1 }), true);
  assert.equal(
    orderHasPackAccessoryTokenLines({ accessories: [{ given_status: 'pack_with_rent' }] }),
    true
  );
});

test('token print stamps ignore empty MySQL zeroes', () => {
  assert.equal(hasTokenPrintStamp(null), false);
  assert.equal(hasTokenPrintStamp('0000-00-00 00:00:00'), false);
  assert.equal(hasTokenPrintStamp('2026-10-09 19:00:00'), true);
});

test('local stamp keeps the first printed time', () => {
  const first = stampTokenPrintedLocally({ id: 'o1' }, 'product');
  assert.equal(hasTokenPrintStamp(first.product_token_printed_at), true);
  const again = stampTokenPrintedLocally(first, 'product');
  assert.equal(again.product_token_printed_at, first.product_token_printed_at);
});
