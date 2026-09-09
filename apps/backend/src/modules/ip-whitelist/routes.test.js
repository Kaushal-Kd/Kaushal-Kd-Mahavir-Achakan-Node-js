import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { ipAccessDenied } from '../../utils/errors.js';

import { requireSuperAdmin } from './routes.js';

test('IP whitelist administration is restricted to super administrators', async () => {
  await assert.doesNotReject(requireSuperAdmin({ authUser: { role: 'super_admin' } }));
  await assert.rejects(
    requireSuperAdmin({ authUser: { role: 'admin' } }),
    (error) => error.statusCode === 403 && error.code === 'FORBIDDEN'
  );
  await assert.rejects(
    requireSuperAdmin({}),
    (error) => error.statusCode === 403 && error.code === 'FORBIDDEN'
  );
});

test(
  'super-admin Fastify hook completes and rejects other roles',
  { timeout: 2_000 },
  async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    app.decorateRequest('authUser', null);
    app.addHook('onRequest', async (request) => {
      request.authUser = { role: request.headers['x-test-role'] };
    });
    app.addHook('onRequest', requireSuperAdmin);
    app.get('/protected', async () => ({ ok: true }));

    const allowed = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-test-role': 'super_admin' },
    });
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(allowed.json(), { ok: true });

    const denied = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-test-role': 'admin' },
    });
    assert.equal(denied.statusCode, 403);
  }
);

test('IP denial uses the stable public error contract', () => {
  const error = ipAccessDenied('203.0.113.10');
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'IP_ACCESS_DENIED');
  assert.equal(
    error.message,
    'Access denied. Your current IP address is not authorized to access Achakan.'
  );
  assert.deepEqual(error.details, { current_ip: '203.0.113.10' });
});
