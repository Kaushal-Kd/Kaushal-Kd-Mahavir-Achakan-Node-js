import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateIpAccess,
  ipMatchesAllowedRanges,
  normalizeAllowedRanges,
  normalizeIpRange,
} from './service.js';

test('normalizes exact IPv4, IPv6, CIDR, duplicates, and mapped IPv6', () => {
  assert.equal(normalizeIpRange(' 203.0.113.10 '), '203.0.113.10');
  assert.equal(normalizeIpRange('2001:db8::1'), '2001:db8:0:0:0:0:0:1');
  assert.equal(normalizeIpRange('203.0.113.0/24'), '203.0.113.0/24');
  assert.equal(normalizeIpRange('::ffff:203.0.113.10'), '203.0.113.10');
  assert.equal(normalizeIpRange('::ffff:203.0.113.10/120'), '203.0.113.0/24');
  assert.deepEqual(normalizeAllowedRanges(['203.0.113.10', ' 203.0.113.10 ', '2001:db8::1'], 10), [
    '203.0.113.10',
    '2001:db8:0:0:0:0:0:1',
  ]);
  assert.throws(() => normalizeIpRange('not-an-ip'), /Invalid IP address/);
  assert.throws(() => normalizeIpRange('::ffff:203.0.113.10/80'), /Invalid IP address/);
});

test('canonicalizes equivalent CIDRs to one network rule', () => {
  assert.deepEqual(
    normalizeAllowedRanges(
      ['203.0.113.10/24', '203.0.113.20/24', '2001:db8::1/64', '2001:db8::2/64'],
      10
    ),
    ['203.0.113.0/24', '2001:db8:0:0:0:0:0:0/64']
  );
});

test('matches exact addresses and IPv4/IPv6 CIDR boundaries', () => {
  assert.equal(ipMatchesAllowedRanges('203.0.113.10', ['203.0.113.10']), true);
  assert.equal(ipMatchesAllowedRanges('::ffff:203.0.113.10', ['203.0.113.10']), true);
  assert.equal(ipMatchesAllowedRanges('203.0.113.255', ['203.0.113.0/24']), true);
  assert.equal(ipMatchesAllowedRanges('203.0.113.255', ['::ffff:203.0.113.10/120']), true);
  assert.equal(ipMatchesAllowedRanges('203.0.114.0', ['203.0.113.0/24']), false);
  assert.equal(ipMatchesAllowedRanges('2001:db8::ffff', ['2001:db8::/32']), true);
  assert.equal(ipMatchesAllowedRanges('2001:db9::1', ['2001:db8::/32']), false);
  assert.equal(ipMatchesAllowedRanges('invalid', ['203.0.113.0/24']), false);
});

test('applies global inheritance and user overrides with super-admin bypass', () => {
  const base = {
    role: 'salesman',
    clientIp: '203.0.113.10',
    globalAllowedRanges: ['203.0.113.0/24'],
    userAllowedRanges: ['198.51.100.0/24'],
  };
  assert.deepEqual(evaluateIpAccess({ ...base, globalEnabled: false, userMode: 'inherit' }), {
    allowed: true,
    restricted: false,
    effective_mode: 'unrestricted',
    allowed_ranges: [],
  });
  assert.equal(
    evaluateIpAccess({ ...base, globalEnabled: true, userMode: 'inherit' }).allowed,
    true
  );
  assert.equal(
    evaluateIpAccess({ ...base, globalEnabled: true, userMode: 'anywhere', clientIp: '10.0.0.1' })
      .allowed,
    true
  );
  assert.equal(
    evaluateIpAccess({ ...base, globalEnabled: false, userMode: 'restricted' }).allowed,
    false
  );
  assert.equal(
    evaluateIpAccess({
      ...base,
      role: 'super_admin',
      globalEnabled: true,
      userMode: 'restricted',
    }).effective_mode,
    'super_admin_bypass'
  );
});

test('fails closed when a restricted policy has no usable ranges', () => {
  const result = evaluateIpAccess({
    role: 'viewer',
    userMode: 'restricted',
    userAllowedRanges: [],
    clientIp: '203.0.113.10',
  });
  assert.equal(result.restricted, true);
  assert.equal(result.allowed, false);

  const inherited = evaluateIpAccess({
    role: 'viewer',
    userMode: 'inherit',
    globalEnabled: true,
    globalAllowedRanges: [],
    clientIp: '203.0.113.10',
  });
  assert.equal(inherited.restricted, true);
  assert.equal(inherited.allowed, false);
});

test('covers every global and user-mode precedence combination', () => {
  const globalRanges = ['203.0.113.0/24'];
  const userRanges = ['198.51.100.0/24'];
  for (const globalEnabled of [false, true]) {
    for (const userMode of ['inherit', 'anywhere', 'restricted']) {
      const result = evaluateIpAccess({
        role: 'salesman',
        userMode,
        userAllowedRanges: userRanges,
        globalEnabled,
        globalAllowedRanges: globalRanges,
        clientIp: '203.0.113.10',
      });
      const expected = userMode === 'anywhere' || userMode === 'inherit';
      assert.equal(result.allowed, expected, `${globalEnabled}/${userMode}`);
    }
  }
});
