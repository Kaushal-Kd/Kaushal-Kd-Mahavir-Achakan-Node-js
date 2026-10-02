import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORDER_NUMBER_FORMAT,
  buildOrderNumber,
  buildPrefixedDocumentNumber,
  composeLetterDocumentPrefix,
  formatBookingDateKey,
  maxPrefixedSequence,
  nextDocumentSequence,
  normalizeOrderNumberFormat,
  resolveShopDocumentNumbering,
  serializeDocumentNumbering,
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

describe('nextDocumentSequence', () => {
  it('uses the configured start when nothing exists yet', () => {
    assert.equal(nextDocumentSequence(0, 2345), 2345);
    assert.equal(nextDocumentSequence(null, 1), 1);
  });

  it('never goes backwards past existing numbers', () => {
    assert.equal(nextDocumentSequence(10, 1), 11);
    assert.equal(nextDocumentSequence(3000, 2345), 3001);
  });
});

describe('maxPrefixedSequence', () => {
  it('reads PREFIX-NNNN numbers and ignores date/hex ids', () => {
    assert.equal(
      maxPrefixedSequence(['PV20260819-5D46B6', 'PV-0007', 'PV-0012', 'RV-0003'], 'PV'),
      12
    );
  });
});

describe('composeLetterDocumentPrefix', () => {
  it('prepends the booking prefix for sales-style numbers', () => {
    assert.equal(composeLetterDocumentPrefix('S', 'MAHAVIR'), 'SMAHAVIR');
    assert.equal(composeLetterDocumentPrefix('P', null), 'P');
  });
});

describe('resolveShopDocumentNumbering', () => {
  it('derives unsaved sale/purchase prefixes from the booking prefix', () => {
    const resolved = resolveShopDocumentNumbering({
      order_number_prefix: 'MAHAVIR',
      order_start_sequence: 8,
    });
    assert.equal(resolved.documents.sale.effective_prefix, 'SMAHAVIR');
    assert.equal(resolved.documents.sale.preview, 'SMAHAVIR-0001');
    assert.equal(resolved.documents.booking.start_sequence, 8);
    assert.equal(resolved.documents.booking.preview, 'MAHAVIR-0008');
  });

  it('uses saved per-type prefix and start sequence', () => {
    const resolved = resolveShopDocumentNumbering({
      order_number_prefix: 'MAHAVIR',
      document_numbering: {
        sale: { prefix: 'SALE', start_sequence: 100 },
        washing: { prefix: 'WASH', start_sequence: 20 },
      },
    });
    assert.equal(resolved.documents.sale.effective_prefix, 'SALE');
    assert.equal(resolved.documents.sale.preview, 'SALE-0100');
    assert.equal(resolved.documents.washing.preview, 'WASH-0020');
    assert.equal(resolved.documents.purchase.effective_prefix, 'PMAHAVIR');
  });
});

describe('serializeDocumentNumbering', () => {
  it('normalizes every document type for storage', () => {
    const saved = serializeDocumentNumbering({
      sale: { prefix: 's-mah', start_sequence: 12 },
    });
    assert.equal(saved.sale.prefix, 'SMAH');
    assert.equal(saved.sale.start_sequence, 12);
    assert.equal(saved.washing.prefix, null);
    assert.equal(saved.washing.start_sequence, 1);
  });
});

describe('buildPrefixedDocumentNumber', () => {
  it('pads to four digits then grows', () => {
    assert.equal(buildPrefixedDocumentNumber({ prefix: 'CN', sequence: 1 }), 'CN-0001');
    assert.equal(buildPrefixedDocumentNumber({ prefix: 'CN', sequence: 2345 }), 'CN-2345');
  });
});
