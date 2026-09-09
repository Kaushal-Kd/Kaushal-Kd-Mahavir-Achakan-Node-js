import assert from 'node:assert/strict';
import test from 'node:test';

import { canEditLoadedRolePermissions, permissionEditorScope } from './permissionEditorState.js';

const loaded = () => ({ shopId: 'shop-a', role: 'salesman', authRole: 'shop_admin',
  currentServer: { bookings: { view: true } }, draftScope: permissionEditorScope('shop-a', 'salesman'), loading: false, error: false });

test('an administrator can edit only the loaded selected-shop role matrix', () => {
  assert.equal(canEditLoadedRolePermissions(loaded()), true);
  assert.equal(canEditLoadedRolePermissions({ ...loaded(), authRole: 'super_admin' }), true);
});

test('changing shop or role cannot save the previous scope grid', () => {
  assert.equal(canEditLoadedRolePermissions({ ...loaded(), shopId: 'shop-b' }), false);
  assert.equal(canEditLoadedRolePermissions({ ...loaded(), role: 'manager' }), false);
});

test('loading, unavailable, failed and malformed responses keep permission editing disabled', () => {
  for (const change of [{ loading: true }, { error: true }, { currentServer: null }, { currentServer: [] }, { currentServer: 'invalid' }, { shopId: null }, { draftScope: '' }]) {
    assert.equal(canEditLoadedRolePermissions({ ...loaded(), ...change }), false);
  }
});

test('administrator target roles and non-admin requesters stay read-only', () => {
  for (const role of ['super_admin', 'shop_admin']) {
    assert.equal(canEditLoadedRolePermissions({ ...loaded(), role, draftScope: permissionEditorScope('shop-a', role) }), false);
  }
  assert.equal(canEditLoadedRolePermissions({ ...loaded(), authRole: 'salesman' }), false);
});
