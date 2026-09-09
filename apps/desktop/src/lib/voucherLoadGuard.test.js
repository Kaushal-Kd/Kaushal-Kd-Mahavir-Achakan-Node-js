import assert from 'node:assert/strict';
import test from 'node:test';

import { createVoucherLoadGuard } from './voucherLoadGuard.js';

test('only the newest receipt link request may open a voucher', () => {
  const guard = createVoucherLoadGuard();
  const first = guard.start();
  assert.equal(first(), true);
  const second = guard.start();
  assert.equal(first(), false);
  assert.equal(second(), true);
});

test('manual create, edit, close or disposal invalidates a pending receipt link', () => {
  for (const action of ['create', 'edit', 'close', 'dispose']) {
    const guard = createVoucherLoadGuard();
    const pending = guard.start();
    guard.cancel();
    assert.equal(pending(), false, action);
    assert.equal(guard.start()(), true);
  }
});

test('a different shop or login cannot receive an old receipt response', () => {
  let scope = 'user-1:shop-1';
  const guard = createVoucherLoadGuard(() => scope);
  const pending = guard.start();
  scope = 'user-1:shop-2';
  assert.equal(pending(), false);
  const next = guard.start();
  scope = 'user-2:shop-2';
  assert.equal(next(), false);
});
