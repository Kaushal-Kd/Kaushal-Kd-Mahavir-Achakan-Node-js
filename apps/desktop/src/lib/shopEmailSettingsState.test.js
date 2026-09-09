import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertEmailSettingsScope,
  emailSettingsDirty,
  emailSettingsForm,
} from './shopEmailSettingsState.js';

test('hydrating email metadata never hydrates a password or ciphertext into the form', () => {
  const data = {
    host: 'smtp.example.test',
    password: 'never-use',
    password_ciphertext: 'never-use',
    revision: 'revision',
  };
  const form = emailSettingsForm(data);
  assert.equal(form.password, '');
  assert.equal(form.password_ciphertext, undefined);
  assert.equal(form.expected_revision, 'revision');
  assert.equal(emailSettingsDirty(form, data), false);
  assert.equal(emailSettingsDirty({ ...form, password: 'replacement' }, data), true);
  assert.equal(emailSettingsDirty({ ...form, port: 465 }, data), true);
});
test('email requests and auth refresh retries stay bound to their original user, role and shop', () => {
  const original = { shopId: 'shop-a', userId: 'user-a', role: 'super_admin' };
  assert.doesNotThrow(() => assertEmailSettingsScope(original, { ...original }));
  for (const change of [
    { shopId: 'shop-b' },
    { userId: 'user-b' },
    { role: 'shop_admin' },
    { shopId: '' },
  ]) {
    assert.throws(
      () => assertEmailSettingsScope(original, { ...original, ...change }),
      /Shop or login changed/
    );
  }
});
