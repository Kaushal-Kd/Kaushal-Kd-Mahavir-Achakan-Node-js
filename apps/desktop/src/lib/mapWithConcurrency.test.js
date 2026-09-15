import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapWithConcurrency } from './mapWithConcurrency.js';

describe('mapWithConcurrency', () => {
  it('keeps order and respects the limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return n * 10;
    });
    assert.deepEqual(result, [10, 20, 30, 40, 50]);
    assert.equal(maxInFlight <= 2, true);
  });
});
