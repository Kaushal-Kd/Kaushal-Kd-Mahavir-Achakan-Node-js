import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatSaleRecordDateTime } from './listTimestampColumns.js';

describe('formatSaleRecordDateTime', () => {
  it('uses saved sale date and time when present', () => {
    assert.equal(
      formatSaleRecordDateTime({
        sale_date: '2026-10-12 20:14:00',
        created_at: '2026-10-12T10:00:00.000Z',
      }),
      '12-10-2026 8:14 PM'
    );
  });

  it('falls back to created_at time when sale_date is midnight', () => {
    assert.equal(
      formatSaleRecordDateTime({
        sale_date: '2026-10-12 00:00:00',
        created_at: '2026-10-12T10:00:00.000Z',
      }),
      '12-10-2026 3:30 PM'
    );
  });
});
