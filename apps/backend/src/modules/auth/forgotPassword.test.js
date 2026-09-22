import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FORGOT_PASSWORD_CONTACT_ADMIN,
  classifyForgotPasswordUser,
} from './forgotPassword.js';

describe('forgot password eligibility', () => {
  it('allows only active shop admin and super admin with email', () => {
    assert.equal(classifyForgotPasswordUser(null).allow, false);
    assert.equal(classifyForgotPasswordUser({ role: 'salesman', is_active: true, email: 'a@b.c' }).allow, false);
    assert.equal(classifyForgotPasswordUser({ role: 'shop_admin', is_active: false, email: 'a@b.c' }).allow, false);
    assert.equal(classifyForgotPasswordUser({ role: 'shop_admin', is_active: true, email: '' }).allow, false);
    assert.equal(classifyForgotPasswordUser({ role: 'shop_admin', is_active: true, email: 'admin@shop.test' }).allow, true);
    assert.equal(classifyForgotPasswordUser({ role: 'super_admin', is_active: true, email: 'root@shop.test' }).allow, true);
  });

  it('tells staff users to contact the administrator', () => {
    const result = classifyForgotPasswordUser({
      role: 'salesman',
      is_active: true,
      email: 'staff@shop.test',
    });
    assert.equal(result.code, 'contact_admin');
    assert.equal(result.message, FORGOT_PASSWORD_CONTACT_ADMIN);
  });
});
