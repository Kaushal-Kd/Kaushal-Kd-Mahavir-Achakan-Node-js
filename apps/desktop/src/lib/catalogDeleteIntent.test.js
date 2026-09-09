import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogDeleteModeForRow } from './catalogDeleteIntent.js';

test('active or unknown catalog rows can only request deactivation', () => {
  for (const row of [undefined, {}, { is_active: true }, { is_active: 1 }, { is_active: '1' }]) {
    assert.equal(catalogDeleteModeForRow(row), 'deactivate');
  }
});

test('permanent delete intent requires an explicitly inactive row', () => {
  for (const is_active of [false, 0, '0']) assert.equal(catalogDeleteModeForRow({ is_active }), 'permanent');
});

test('retry intent stays pinned to the clicked active row despite a later inactive list response', () => {
  const clickedRow = Object.freeze({ id: 'product-1', is_active: true });
  const refreshedRow = { ...clickedRow, is_active: false };
  assert.equal(catalogDeleteModeForRow(clickedRow), 'deactivate');
  assert.equal(catalogDeleteModeForRow(refreshedRow), 'permanent');
  assert.equal(catalogDeleteModeForRow(clickedRow), 'deactivate');
});
