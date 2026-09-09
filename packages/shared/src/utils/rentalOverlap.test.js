import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  earliestPickupAfterReturnGap,
  latestReturnBeforePickupGap,
  rentalDateRangeOverlaps,
} from './rentalOverlap.js';

describe('rentalDateRangeOverlaps', () => {
  it('blocks earlier booking when later order has previous gap', () => {
    assert.equal(
      rentalDateRangeOverlaps('2026-06-10', '2026-06-12', '2026-06-13', '2026-06-17', 3, 3),
      true
    );
  });

  it('allows earlier booking ending before previous-gap buffer', () => {
    assert.equal(
      rentalDateRangeOverlaps('2026-06-07', '2026-06-09', '2026-06-13', '2026-06-17', 3, 3),
      false
    );
  });

  it('blocks next pickup inside next-gap after return', () => {
    assert.equal(
      rentalDateRangeOverlaps('2026-06-18', '2026-06-20', '2026-06-13', '2026-06-17', 3, 0),
      true
    );
  });

  it('allows pickup after return plus next gap', () => {
    assert.equal(
      rentalDateRangeOverlaps('2026-06-21', '2026-06-23', '2026-06-13', '2026-06-17', 3, 0),
      false
    );
  });

  it('latestReturnBeforePickupGap and earliestPickupAfterReturnGap match examples', () => {
    assert.equal(latestReturnBeforePickupGap('2026-06-13', 3), '2026-06-09');
    assert.equal(earliestPickupAfterReturnGap('2026-06-17', null, 3), '2026-06-21');
  });
});
