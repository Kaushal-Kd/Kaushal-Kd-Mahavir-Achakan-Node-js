import assert from 'node:assert/strict';
import test from 'node:test';

import {
  globalIpWhitelistSchema,
  shopIpCommandSchema,
  userIpWhitelistSchema,
} from './ipWhitelist.js';

test('global IP policy requires ranges only when enabled', () => {
  assert.equal(
    globalIpWhitelistSchema.safeParse({ enabled: false, allowed_ranges: [] }).success,
    true
  );
  assert.equal(
    globalIpWhitelistSchema.safeParse({ enabled: true, allowed_ranges: [] }).success,
    false
  );
  assert.equal(
    globalIpWhitelistSchema.safeParse({ enabled: true, allowed_ranges: ['203.0.113.0/24'] })
      .success,
    true
  );
});

test('restricted user policy requires a custom range', () => {
  assert.equal(
    userIpWhitelistSchema.safeParse({ mode: 'inherit', allowed_ranges: [] }).success,
    true
  );
  assert.equal(
    userIpWhitelistSchema.safeParse({ mode: 'anywhere', allowed_ranges: [] }).success,
    true
  );
  assert.equal(
    userIpWhitelistSchema.safeParse({ mode: 'restricted', allowed_ranges: [] }).success,
    false
  );
  assert.equal(
    userIpWhitelistSchema.safeParse({ mode: 'restricted', allowed_ranges: ['2001:db8::/32'] })
      .success,
    true
  );
});

test('shop policy accepts approved-device mode without an IP range', () => {
  assert.equal(
    shopIpCommandSchema.safeParse({
      idempotency_key: '11111111-1111-4111-8111-111111111111',
      expected_revision: 0,
      policy: {
        kind: 'user',
        user_id: '22222222-2222-4222-8222-222222222222',
        mode: 'registered_device',
        allowed_ranges: [],
      },
    }).success,
    true
  );
});
