import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveSalesListSort } from './listSort.js';

describe('resolveSalesListSort', () => {
  it('defaults to bill number high to low', () => {
    assert.equal(resolveSalesListSort({}), '-s.bill_no,-s.created_at');
    assert.equal(resolveSalesListSort({ sort: '-s.sale_date' }), '-s.bill_no,-s.created_at');
  });

  it('keeps A–Z and Z–A on customer name with bill sequence as the tiebreaker', () => {
    assert.equal(resolveSalesListSort({ sort_by: 'low' }), 's.bill_no,-s.created_at');
    assert.equal(resolveSalesListSort({ sort_by: 'az' }), 's.customer_name,-s.bill_no,-s.created_at');
    assert.equal(resolveSalesListSort({ sort_by: 'za' }), '-s.customer_name,-s.bill_no,-s.created_at');
  });
});
