import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORDER_NUMBER_FORMAT,
  buildOrderNumber,
  formatBookingDateKey,
  normalizeOrderNumberFormat,
} from './billNumber.js';

describe('normalizeOrderNumberFormat', () => {
  it('defaults unknown values to prefix_sequence', () => {
    assert.equal(normalizeOrderNumberFormat(null), ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE);
    assert.equal(normalizeOrderNumberFormat('invalid'), ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE);
  });

  it('accepts configured format keys', () => {
    assert.equal(normalizeOrderNumberFormat('date_sequence'), ORDER_NUMBER_FORMAT.DATE_SEQUENCE);
  });
});

describe('formatBookingDateKey', () => {
  it('formats ISO dates as YYYYMMDD', () => {
    assert.equal(formatBookingDateKey('2026-07-04'), '20260704');
  });

  it('uses fallback date when booking date is invalid', () => {
    assert.equal(formatBookingDateKey(null, { fallbackDate: '2026-07-04' }), '20260704');
  });
});

describe('buildOrderNumber', () => {
  it('builds prefix + four-digit sequence by default', () => {
    assert.equal(
      buildOrderNumber({ prefix: 'MAHAVIR', sequence: 1 }),
      'MAHAVIR-0001'
    );
  });

  it('builds date + sequence format', () => {
    assert.equal(
      buildOrderNumber({
        format: ORDER_NUMBER_FORMAT.DATE_SEQUENCE,
        sequence: 1,
        bookingDate: '2026-07-04',
      }),
      '2026070401'
    );
    assert.equal(
      buildOrderNumber({
        format: ORDER_NUMBER_FORMAT.DATE_SEQUENCE,
        sequence: 12,
        bookingDate: '2026-07-04',
      }),
      '2026070412'
    );
  });

  it('allows natural width for sequence 100+ in date formats', () => {
    assert.equal(
      buildOrderNumber({
        format: ORDER_NUMBER_FORMAT.DATE_SEQUENCE,
        sequence: 100,
        bookingDate: '2026-07-04',
      }),
      '20260704100'
    );
  });

  it('builds prefix + date + sequence format', () => {
    assert.equal(
      buildOrderNumber({
        format: ORDER_NUMBER_FORMAT.PREFIX_DATE_SEQUENCE,
        prefix: 'MAHAVIR',
        sequence: 1,
        bookingDate: '2026-07-04',
      }),
      'MAHAVIR-2026070401'
    );
  });

  it('uses previewDate when bookingDate is missing', () => {
    assert.equal(
      buildOrderNumber({
        format: ORDER_NUMBER_FORMAT.PREFIX_DATE_SEQUENCE,
        prefix: 'MAHAVIR',
        sequence: 2,
        previewDate: '2026-07-05',
      }),
      'MAHAVIR-2026070502'
    );
  });
});
