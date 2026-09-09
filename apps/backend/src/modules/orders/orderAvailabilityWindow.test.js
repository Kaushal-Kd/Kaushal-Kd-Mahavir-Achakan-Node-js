import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeOrderAvailabilityWindow } from './orderAvailabilityWindow.js';

describe('normalizeOrderAvailabilityWindow', () => {
  it('normalizes MySQL Date objects to ISO dates', () => {
    assert.deepEqual(
      normalizeOrderAvailabilityWindow({
        pickup_date: new Date('2026-08-17T00:00:00.000Z'),
        return_date: new Date('2026-08-20T00:00:00.000Z'),
      }),
      { from: '2026-08-17', to: '2026-08-20' }
    );
  });

  it('keeps existing ISO date strings', () => {
    assert.deepEqual(
      normalizeOrderAvailabilityWindow({
        pickup_date: '2026-08-17',
        return_date: '2026-08-20',
      }),
      { from: '2026-08-17', to: '2026-08-20' }
    );
  });

  it('uses pickup as the return date when return is missing', () => {
    assert.deepEqual(
      normalizeOrderAvailabilityWindow({ pickup_date: '2026-08-17', return_date: null }),
      { from: '2026-08-17', to: '2026-08-17' }
    );
  });

  it('rejects an invalid pickup date', () => {
    assert.equal(
      normalizeOrderAvailabilityWindow({ pickup_date: 'Mon Aug 17', return_date: '2026-08-20' }),
      null
    );
  });

  it('rejects a non-empty invalid return date', () => {
    assert.equal(
      normalizeOrderAvailabilityWindow({ pickup_date: '2026-08-17', return_date: 'Thu Aug 20' }),
      null
    );
  });
});
