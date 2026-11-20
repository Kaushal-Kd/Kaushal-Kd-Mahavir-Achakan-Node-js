import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIONS,
  MENU_PERMISSION_TARGETS,
  hasPermission,
  permissionActionsForScreen,
  permissionScreenGroups,
} from './permissions.js';

test('screen groups follow the sidebar and cover every menu key once', () => {
  const groups = permissionScreenGroups();
  assert.equal(groups[0].group, 'Dashboard');
  const keys = groups.flatMap((g) => g.screens.map((s) => s.key));
  assert.equal(keys.length, MENU_PERMISSION_TARGETS.length);
  assert.equal(new Set(keys).size, keys.length);
  const finance = groups.find((g) => g.group === 'Finance Report');
  assert.ok(finance.screens.some((s) => s.label === 'Daily Cashbook'));
});

test('screens only expose actions that make sense for them', () => {
  assert.deepEqual(permissionActionsForScreen('menu.dashboard'), [ACTIONS.VIEW]);
  assert.deepEqual(permissionActionsForScreen('menu.daily_cashbook'), [
    ACTIONS.VIEW,
    ACTIONS.EXPORT,
    ACTIONS.PRINT,
  ]);
  assert.ok(permissionActionsForScreen('menu.bookings').includes(ACTIONS.DELETE));
});

test('sensitive data is allowed until explicitly turned off', () => {
  const user = (permissions) => ({ role: 'salesman', permissions });
  assert.equal(hasPermission(user({}), 'sensitive.purchase_price', ACTIONS.VIEW), true);
  assert.equal(
    hasPermission(user({ 'sensitive.purchase_price': { view: false } }), 'sensitive.purchase_price', ACTIONS.VIEW),
    false
  );
  assert.equal(hasPermission({ role: 'shop_admin' }, 'sensitive.purchase_price', ACTIONS.VIEW), true);
});

test('a screen key falls back to its module when not configured', () => {
  const u = { role: 'salesman', permissions: { reports: { view: true } } };
  assert.equal(hasPermission(u, 'menu.trial_balance', ACTIONS.VIEW), true);
  const blocked = { role: 'salesman', permissions: { reports: { view: true }, 'menu.trial_balance': { view: false } } };
  assert.equal(hasPermission(blocked, 'menu.trial_balance', ACTIONS.VIEW), false);
});
