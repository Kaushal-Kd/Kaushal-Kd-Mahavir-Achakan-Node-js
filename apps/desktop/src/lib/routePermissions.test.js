import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACTIONS, MODULES } from '@wrs/shared';

import { canAccessRoute, resolveMenuPermission } from './routePermissions.js';

const userWith = (permissions) => ({ role: 'salesman', permissions });

describe('leaf menu permissions', () => {
  it('blocks direct navigation when the parent report is allowed but the leaf is denied', () => {
    const user = userWith({
      [MODULES.REPORTS]: { [ACTIONS.VIEW]: true },
      'menu.pending_bills': { [ACTIONS.VIEW]: false },
    });
    assert.equal(canAccessRoute(user, '/reports/pending-bills'), false);
  });

  it('keeps legacy permission snapshots working by inheriting the parent module', () => {
    const user = userWith({ [MODULES.REPORTS]: { [ACTIONS.VIEW]: true } });
    assert.equal(canAccessRoute(user, '/reports/pending-bills'), true);
  });

  it('maps master and settings leaves to their own permission keys', () => {
    assert.equal(resolveMenuPermission('/master/colors'), 'menu.master_colors');
    assert.equal(resolveMenuPermission('/settings/devices'), 'menu.settings_devices');
  });
});
