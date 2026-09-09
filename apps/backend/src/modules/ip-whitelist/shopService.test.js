import assert from 'node:assert/strict';
import test from 'node:test';
import { combineShopIpAccess } from './shopService.js';
import { evaluateIpAccess } from './service.js';
import { shopIpCommandSchema } from '@wrs/shared';

test('shop IP overrides never undo installation-level denial', () => {
  const denied = { allowed: false, restricted: true, effective_mode: 'global_restricted' };
  assert.deepEqual(combineShopIpAccess(denied, { allowed: true, restricted: false }), denied);
  assert.equal(
    combineShopIpAccess({ allowed: true, restricted: false }, { allowed: false, restricted: true })
      .allowed,
    false
  );
});
test('Super Admin retains recovery access at both policy levels', () => {
  const policy = evaluateIpAccess({
    role: 'super_admin',
    clientIp: '203.0.113.1',
    globalEnabled: true,
    globalAllowedRanges: ['192.0.2.1'],
    userMode: 'restricted',
    userAllowedRanges: [],
  });
  assert.equal(combineShopIpAccess(policy, policy).allowed, true);
  assert.equal(combineShopIpAccess(policy, policy).restricted, false);
});
test('shop commands require revisions and reject empty enabled policies and forged fields', () => {
  const cmd = {
    idempotency_key: '11111111-1111-4111-8111-111111111111',
    expected_revision: 0,
    policy: { kind: 'shop', enabled: true, allowed_ranges: ['203.0.113.1'] },
  };
  assert.equal(shopIpCommandSchema.safeParse(cmd).success, true);
  assert.equal(shopIpCommandSchema.safeParse({ ...cmd, expected_revision: -1 }).success, false);
  assert.equal(
    shopIpCommandSchema.safeParse({ ...cmd, policy: { ...cmd.policy, allowed_ranges: [] } })
      .success,
    false
  );
  assert.equal(shopIpCommandSchema.safeParse({ ...cmd, shop_id: 'another' }).success, false);
});
