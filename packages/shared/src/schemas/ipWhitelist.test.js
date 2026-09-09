import assert from 'node:assert/strict';
import test from 'node:test';

import { globalIpWhitelistSchema, userIpWhitelistSchema } from './ipWhitelist.js';

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
