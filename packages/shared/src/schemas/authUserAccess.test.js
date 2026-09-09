import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createUserSchema } from './user.js';
import { confirmPasswordOtpSchema, loginSchema } from './auth.js';

describe('phone login transition schemas', () => {
  it('accepts phone identity and legacy email payloads', () => {
    assert.equal(
      loginSchema.parse({ identity: '9876543210', password: 'secret1' }).identity,
      '9876543210'
    );
    assert.equal(
      loginSchema.parse({ email: 'old@example.com', password: 'secret1' }).identity,
      'old@example.com'
    );
  });

  it('requires a login phone for every new user and email for administrators', () => {
    const base = { name: 'Test', role: 'salesman', password: 'Password1' };
    assert.equal(createUserSchema.safeParse(base).success, false);
    assert.equal(
      createUserSchema.safeParse({ ...base, role: 'shop_admin', phone: '9876543210' }).success,
      false
    );
  });

  it('requires a six-digit OTP and matching strong password', () => {
    const result = confirmPasswordOtpSchema.safeParse({
      challenge_id: '01234567-89ab-4def-8123-456789abcdef',
      otp: '123456',
      new_password: 'Password1',
      confirm: 'Password1',
    });
    assert.equal(result.success, true);
  });
});
