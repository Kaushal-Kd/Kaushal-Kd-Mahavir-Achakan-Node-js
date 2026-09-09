import assert from 'node:assert/strict';
import test from 'node:test';

import { assessLoginReadiness } from './loginReadiness.js';

const user = { id: 'one', name: 'Test Admin', role: 'shop_admin', is_active: true,
  login_phone: '9876543210', phone: '9876543210', email: 'admin@example.test' };

test('valid canonical phone and admin email allow phone-only readiness', () => {
  assert.deepEqual(assessLoginReadiness([user]), { ready_for_phone_only: true, blocked: [] });
});

test('null, empty, whitespace, malformed and noncanonical phone values all block the same gate', () => {
  for (const phone of [null, '', ' ', '12345', '+91 9876543210', ' 9876543210 ']) {
    const result = assessLoginReadiness([{ ...user, login_phone: phone }]);
    assert.equal(result.ready_for_phone_only, false, String(phone));
    assert.equal(result.blocked[0].id, user.id);
  }
});

test('normalized duplicates include older unmigrated and inactive accounts', () => {
  for (const isActive of [true, false]) {
    const result = assessLoginReadiness([user, {
      ...user, id: 'two', login_phone: isActive ? null : user.login_phone,
      phone: '+91 98765 43210', is_active: isActive,
    }]);
    assert.equal(result.ready_for_phone_only, false);
    assert.match(result.blocked[0].reason, /another account/);
    assert.equal(result.blocked.length, isActive ? 2 : 1);
  }
});

test('admin email validation rejects blank and malformed values; staff do not require email', () => {
  for (const email of [null, '', ' ', 'not-an-email']) {
    assert.equal(assessLoginReadiness([{ ...user, email }]).ready_for_phone_only, false);
    assert.equal(assessLoginReadiness([{ ...user, email, role: 'salesman' }]).ready_for_phone_only, true);
  }
});

test('inactive accounts without phones do not block readiness and no record is rewritten', () => {
  const inputs = [user, { ...user, id: 'inactive', is_active: false, phone: '', login_phone: '' }];
  const before = structuredClone(inputs);
  assert.equal(assessLoginReadiness(inputs).ready_for_phone_only, true);
  assert.deepEqual(inputs, before);
  assert.equal(assessLoginReadiness([user, { ...user, id: 'inactive-legacy',
    is_active: false, login_phone: null }]).ready_for_phone_only, true);
});
