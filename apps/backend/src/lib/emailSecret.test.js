import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { decryptEmailPassword, emailEncryptionReady, encryptEmailPassword } from './emailSecret.js';

test('email secret encryption uses fresh authenticated nonces and preserves exact bytes', () => {
  const key = randomBytes(32).toString('base64');
  const password = ' synthetic-SMTP-password ! ';
  const first = encryptEmailPassword(password, 'shop-a', key);
  const second = encryptEmailPassword(password, 'shop-a', key);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(decryptEmailPassword(first, 'shop-a', key), password);
});
test('copied, corrupted, or wrongly keyed credentials fail closed without exposing secrets', () => {
  const key = randomBytes(32).toString('base64');
  const cipher = encryptEmailPassword('private-test-value', 'shop-a', key);
  for (const action of [
    () => decryptEmailPassword(cipher, 'shop-b', key),
    () => decryptEmailPassword(cipher, 'shop-a', randomBytes(32).toString('base64')),
    () => decryptEmailPassword('v1.invalid.invalid.invalid', 'shop-a', key),
  ]) {
    assert.throws(
      action,
      (error) =>
        error.message.includes('cannot be unlocked') &&
        !error.message.includes('private-test-value')
    );
  }
});
test('a dedicated 32-byte encryption key is required without an insecure fallback', () => {
  for (const key of ['', 'password', randomBytes(16).toString('base64')]) {
    assert.equal(emailEncryptionReady(key), false);
    assert.throws(() => encryptEmailPassword('test', 'shop-a', key), /SHOP_SMTP_ENCRYPTION_KEY/);
  }
  assert.equal(emailEncryptionReady(randomBytes(32).toString('base64')), true);
});
