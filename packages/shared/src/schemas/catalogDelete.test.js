import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogDeleteSchema } from './catalogDelete.js';

test('missing delete mode is always deactivation, including old password-only requests', () => {
  assert.deepEqual(catalogDeleteSchema.parse({}), { mode: 'deactivate' });
  assert.deepEqual(catalogDeleteSchema.parse({ admin_password: 'synthetic-test-only' }), { mode: 'deactivate' });
});

test('permanent delete intent must be explicit and supported', () => {
  assert.deepEqual(catalogDeleteSchema.parse({ mode: 'permanent' }), { mode: 'permanent' });
  for (const mode of ['delete', 'permanently_deleted', true, null, '']) {
    assert.equal(catalogDeleteSchema.safeParse({ mode }).success, false);
  }
});
