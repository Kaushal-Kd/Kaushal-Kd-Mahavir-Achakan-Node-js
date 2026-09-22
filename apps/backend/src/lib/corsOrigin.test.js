import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedCorsOrigin, loopbackTwinOrigin } from './corsOrigin.js';

test('loopbackTwinOrigin swaps localhost and 127.0.0.1', () => {
  assert.equal(loopbackTwinOrigin('http://localhost:5173'), 'http://127.0.0.1:5173');
  assert.equal(loopbackTwinOrigin('http://127.0.0.1:5173'), 'http://localhost:5173');
  assert.equal(loopbackTwinOrigin('https://dashboard.achakan.com'), null);
});

test('isAllowedCorsOrigin accepts the loopback twin of a listed origin', () => {
  const allowed = ['http://localhost:5173', 'app://.', 'https://dashboard.achakan.com'];
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', allowed), true);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:5173', allowed), true);
  assert.equal(isAllowedCorsOrigin('https://dashboard.achakan.com', allowed), true);
  assert.equal(isAllowedCorsOrigin('https://evil.example', allowed), false);
  assert.equal(isAllowedCorsOrigin('', allowed), true);
});
