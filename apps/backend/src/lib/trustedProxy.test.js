import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { TRUSTED_PROXY_HOPS } from './trustedProxy.js';

test('uses the nearest forwarded address and ignores a forged earlier address', async (t) => {
  const app = Fastify({ trustProxy: TRUSTED_PROXY_HOPS });
  t.after(() => app.close());
  app.get('/', async (request) => ({ ip: request.ip }));

  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: {
      'x-forwarded-for': '203.0.113.77, 198.51.100.42',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ip: '198.51.100.42' });
});
