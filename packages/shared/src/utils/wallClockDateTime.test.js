import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatDateTime,
  formatInstantDateTime,
  formatPaymentDateTime,
  formatWallClockDateTime,
  getIndiaDateTimeParts,
  normalizeSqlDateToIso,
  parseInstant,
  parseWallClockDateTimeParts,
  serializeInstant,
  toLocalISODate,
} from './date.js';

describe('parseInstant', () => {
  it('parses timezone-less MySQL datetime as UTC instant', () => {
    const d = parseInstant('2026-06-24 07:07:00');
    assert.ok(d);
    assert.equal(d.toISOString(), '2026-06-24T07:07:00.000Z');
  });

  it('parses ISO without Z suffix as UTC instant', () => {
    const d = parseInstant('2026-06-24T07:07:00.000');
    assert.ok(d);
    assert.equal(d.toISOString(), '2026-06-24T07:07:00.000Z');
  });

  it('returns null for date-only strings', () => {
    assert.equal(parseInstant('2026-06-24'), null);
  });
});

describe('serializeInstant', () => {
  it('emits ISO Z for timezone-less strings', () => {
    assert.equal(serializeInstant('2026-06-24 07:07:00'), '2026-06-24T07:07:00.000Z');
  });
});

describe('parseWallClockDateTimeParts', () => {
  it('parses MySQL datetime as IST wall clock', () => {
    const parts = parseWallClockDateTimeParts('2026-06-20 17:54:00');
    assert.deepEqual(parts, {
      year: '2026',
      month: '06',
      day: '20',
      hour: '17',
      minute: '54',
    });
  });

  it('converts Date instances to India time parts', () => {
    const parts = getIndiaDateTimeParts('2026-06-20T12:24:00.000Z');
    assert.equal(parts?.hour, '17');
    assert.equal(parts?.minute, '54');
  });
});

describe('formatInstantDateTime', () => {
  it('converts UTC MySQL datetime string to IST display', () => {
    assert.equal(formatInstantDateTime('2026-06-24 07:07:00'), '24-06-2026 12:37 PM');
  });

  it('converts UTC ISO without Z to IST display', () => {
    assert.equal(formatInstantDateTime('2026-06-24T07:07:00.000'), '24-06-2026 12:37 PM');
  });

  it('formats UTC ISO instants in India time', () => {
    assert.equal(formatInstantDateTime('2026-06-20T12:24:00.000Z'), '20-06-2026 5:54 PM');
  });

  it('converts a delivered_at UTC instant to IST (Booking List Delivered column)', () => {
    assert.equal(formatInstantDateTime('2026-07-05 03:51:00'), '05-07-2026 9:21 AM');
    assert.equal(formatInstantDateTime('2026-07-05T03:51:00.000Z'), '05-07-2026 9:21 AM');
  });
});

describe('formatWallClockDateTime', () => {
  it('formats timezone-less values without UTC shift', () => {
    assert.equal(formatWallClockDateTime('2026-06-20 17:54:00'), '20-06-2026 5:54 PM');
  });
});

describe('formatDateTime', () => {
  it('delegates to instant conversion for audit timestamps', () => {
    assert.equal(formatDateTime('2026-06-24 07:07:00'), '24-06-2026 12:37 PM');
  });
});

describe('formatPaymentDateTime', () => {
  it('uses payment_date for the day and India time from created_at', () => {
    const row = {
      payment_date: '2026-06-19',
      created_at: '2026-06-20T12:24:00.000Z',
    };
    assert.equal(formatPaymentDateTime(row), '19-06-2026 5:54 PM');
  });

  it('uses payment_date day with UTC created_at converted to IST time', () => {
    const row = {
      payment_date: '2026-06-24',
      created_at: '2026-06-24 07:07:00',
    };
    assert.equal(formatPaymentDateTime(row), '24-06-2026 12:37 PM');
  });

  it('shows date only when no created_at is available', () => {
    assert.equal(formatPaymentDateTime({ payment_date: '2026-06-19' }), '19-06-2026');
  });

  it('does not map locale date strings without year to 2001', () => {
    const broken = String(new Date('2026-07-09T00:00:00.000Z')).slice(0, 10);
    assert.equal(broken, 'Thu Jul 09');
    assert.equal(formatPaymentDateTime({ payment_date: broken }), '');
    assert.equal(
      formatPaymentDateTime({ payment_date: broken, created_at: '2026-07-09T10:49:00.000Z' }),
      formatInstantDateTime('2026-07-09T10:49:00.000Z')
    );
  });
});

describe('normalizeSqlDateToIso', () => {
  it('normalizes Date objects from MySQL DATE columns', () => {
    assert.equal(normalizeSqlDateToIso(new Date('2026-07-09T00:00:00.000Z')), '2026-07-09');
  });

  it('ignores locale date strings without a year', () => {
    const broken = String(new Date('2026-07-09T00:00:00.000Z')).slice(0, 10);
    assert.equal(normalizeSqlDateToIso(broken), '');
  });
});

describe('toLocalISODate', () => {
  it('returns India calendar date for UTC instants near midnight', () => {
    assert.equal(toLocalISODate('2026-06-20T20:30:00.000Z'), '2026-06-21');
  });
});
