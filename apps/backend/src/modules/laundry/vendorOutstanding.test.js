import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOutstandingFromJobRows,
  findLatestJobId,
  normalizeVendorName,
  vendorListKey,
  vendorMatchScope,
} from './vendorOutstanding.js';

describe('vendorMatchScope', () => {
  it('normalizes vendor name for matching', () => {
    assert.deepEqual(vendorMatchScope('acc-1', '  Laundry Vendor  '), {
      accountId: 'acc-1',
      name: 'laundry vendor',
    });
  });
});

describe('vendorListKey', () => {
  it('prefers account id over name', () => {
    assert.equal(vendorListKey('acc-1', 'Vendor A'), 'acc-1');
  });

  it('falls back to normalized name key', () => {
    assert.equal(vendorListKey(null, 'Vendor A'), 'name:vendor a');
  });
});

describe('buildOutstandingFromJobRows', () => {
  it('aggregates only unpaid bills and sorts by job no', () => {
    const result = buildOutstandingFromJobRows([
      {
        id: '3',
        job_no: 'W-0003',
        laundry_date: '2026-06-03',
        payable_amount: 500,
        paid_to_washing_amount: 200,
      },
      {
        id: '1',
        job_no: 'W-0001',
        laundry_date: '2026-06-01',
        payable_amount: 1000,
        paid_to_washing_amount: 1000,
      },
      {
        id: '2',
        job_no: 'W-0002',
        laundry_date: '2026-06-02',
        payable_amount: 300,
        paid_to_washing_amount: 0,
      },
    ]);

    assert.equal(result.bills.length, 2);
    assert.equal(result.bills[0].jobNo, 'W-0002');
    assert.equal(result.bills[1].jobNo, 'W-0003');
    assert.equal(result.bills[0].remaining, 300);
    assert.equal(result.bills[1].remaining, 300);
    assert.equal(result.totals.totalRemaining, 600);
    assert.equal(result.totals.billCount, 2);
  });

  it('returns empty totals when all bills are paid', () => {
    const result = buildOutstandingFromJobRows([
      {
        id: '1',
        job_no: 'W-0001',
        payable_amount: 100,
        paid_to_washing_amount: 100,
      },
    ]);
    assert.equal(result.bills.length, 0);
    assert.equal(result.totals.totalRemaining, 0);
    assert.equal(result.totals.billCount, 0);
  });
});

describe('findLatestJobId', () => {
  it('picks newest created_at', () => {
    const latest = findLatestJobId([
      { id: 'a', created_at: '2026-06-01 10:00:00', bill_seq: 1 },
      { id: 'b', created_at: '2026-06-05 10:00:00', bill_seq: 5 },
      { id: 'c', created_at: '2026-06-03 10:00:00', bill_seq: 3 },
    ]);
    assert.equal(latest, 'b');
  });

  it('uses bill_seq as tie-breaker', () => {
    const latest = findLatestJobId([
      { id: 'a', created_at: '2026-06-01 10:00:00', bill_seq: 1 },
      { id: 'b', created_at: '2026-06-01 10:00:00', bill_seq: 2 },
    ]);
    assert.equal(latest, 'b');
  });
});

describe('normalizeVendorName', () => {
  it('lowercases and trims', () => {
    assert.equal(normalizeVendorName('  ABC Vendor '), 'abc vendor');
  });
});
