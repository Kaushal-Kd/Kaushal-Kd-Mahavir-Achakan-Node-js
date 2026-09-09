import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isAccessoryLowStock } from './accessoryStockMetrics.js';

describe('isAccessoryLowStock', () => {
  it('returns false when threshold is 0 even if below global limit', () => {
    assert.equal(isAccessoryLowStock(1, 0, 4), false);
  });

  it('returns false when threshold is 0 and global limit is 0', () => {
    assert.equal(isAccessoryLowStock(3, 0, 0), false);
  });

  it('returns true when in shop is below a positive threshold', () => {
    assert.equal(isAccessoryLowStock(1, 5, 4), true);
  });

  it('returns false when in shop meets a positive threshold', () => {
    assert.equal(isAccessoryLowStock(5, 5, 4), false);
  });
});
