import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACTIONS, MODULES } from '@wrs/shared';

import { normalizeMatrix } from './service.js';

describe('shop permission normalization', () => {
  it('expands every menu leaf and inherits its parent module for migrated users', () => {
    const normalized = normalizeMatrix({
      [MODULES.REPORTS]: { [ACTIONS.VIEW]: true },
    });
    assert.equal(normalized['menu.pending_bills'][ACTIONS.VIEW], true);
    assert.equal(normalized['menu.gst_report'][ACTIONS.VIEW], true);
  });

  it('preserves an explicit leaf override', () => {
    const normalized = normalizeMatrix({
      [MODULES.REPORTS]: { [ACTIONS.VIEW]: true },
      'menu.pending_bills': { [ACTIONS.VIEW]: false },
    });
    assert.equal(normalized['menu.pending_bills'][ACTIONS.VIEW], false);
  });
});
