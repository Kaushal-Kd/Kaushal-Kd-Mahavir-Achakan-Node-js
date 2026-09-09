import assert from 'node:assert/strict';
import test from 'node:test';

import { shopEmailSettingsSchema, testShopEmailSchema } from './shopEmailSettings.js';

const valid = {
  host: ' SMTP.Example.Com ',
  port: 587,
  username: ' sender@example.test ',
  from_email: 'sender@example.test',
  password: ' preserve spaces ',
  expected_revision: null,
};
test('SMTP schema normalizes host/user but never trims the password', () => {
  const parsed = shopEmailSettingsSchema.parse(valid);
  assert.equal(parsed.host, 'smtp.example.com');
  assert.equal(parsed.username, 'sender@example.test');
  assert.equal(parsed.password, ' preserve spaces ');
  assert.equal(shopEmailSettingsSchema.parse({ ...valid, port: 465, password: '' }).password, '');
});
test('SMTP schema rejects URLs, IPs, header injection, insecure ports and unexpected secrets', () => {
  for (const change of [
    { host: 'http://smtp.example.com' },
    { host: '127.0.0.1' },
    { host: 'localhost' },
    { host: 'smtp.example.com:587' },
    { port: 25 },
    { port: 587.1 },
    { username: 'user\r\nBcc: x' },
    { from_email: 'sender@example.test\r\nBcc: x' },
    { password_ciphertext: 'forged' },
    { expected_revision: 'bad' },
  ]) {
    assert.equal(shopEmailSettingsSchema.safeParse({ ...valid, ...change }).success, false);
  }
});
test('test-email schema cannot override the recipient or message', () => {
  const body = { expected_revision: 'd26d26e4-6e55-4b42-8717-bf007a1a9bd1' };
  assert.equal(testShopEmailSchema.safeParse(body).success, true);
  for (const extra of [
    { to: 'outsider@example.test' },
    { subject: 'override' },
    { password: 'override' },
  ]) {
    assert.equal(testShopEmailSchema.safeParse({ ...body, ...extra }).success, false);
  }
});
