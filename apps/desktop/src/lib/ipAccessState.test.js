import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IP_VALIDATION_MAX_AUTO_RETRIES,
  shouldBlockForIpValidation,
  shouldScheduleIpValidationRetry,
  shouldWaitForRestrictedBootstrap,
} from './ipAccessState.js';

test('restricted sessions fail closed offline and while reconnect validation is pending', () => {
  assert.equal(
    shouldBlockForIpValidation({
      hasToken: true,
      restricted: true,
      online: false,
      validationPending: false,
    }),
    true
  );
  assert.equal(
    shouldBlockForIpValidation({
      hasToken: true,
      restricted: true,
      online: true,
      validationPending: true,
    }),
    true
  );
  assert.equal(
    shouldBlockForIpValidation({
      hasToken: true,
      restricted: false,
      online: false,
      validationPending: false,
    }),
    false
  );
});

test('persisted restricted sessions wait for server validation before rendering', () => {
  assert.equal(
    shouldWaitForRestrictedBootstrap({ hasToken: true, hasUser: true, restricted: true }),
    true
  );
  assert.equal(
    shouldWaitForRestrictedBootstrap({ hasToken: true, hasUser: true, restricted: false }),
    false
  );
});

test('failed validation retries are bounded and success restores access', () => {
  const pendingState = {
    hasToken: true,
    restricted: true,
    online: true,
    validationPending: true,
  };
  assert.equal(shouldScheduleIpValidationRetry({ ...pendingState, automaticRetries: 0 }), true);
  assert.equal(
    shouldScheduleIpValidationRetry({
      ...pendingState,
      automaticRetries: IP_VALIDATION_MAX_AUTO_RETRIES,
    }),
    false
  );
  assert.equal(
    shouldScheduleIpValidationRetry({
      ...pendingState,
      validationPending: false,
      automaticRetries: 1,
    }),
    false
  );
  assert.equal(shouldBlockForIpValidation({ ...pendingState, validationPending: false }), false);
});
