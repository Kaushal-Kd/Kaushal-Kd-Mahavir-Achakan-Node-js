import assert from 'node:assert/strict';
import test from 'node:test';

import { flyoutStyle } from './sidebarFlyoutPosition.js';

test('flyout sits to the right of the icon', () => {
  const style = flyoutStyle({ top: 120, right: 64 }, { viewportHeight: 800 });
  assert.equal(style.left, 70);
  assert.equal(style.top, 120);
});

test('flyout shifts up when it would overflow the viewport', () => {
  const style = flyoutStyle({ top: 720, right: 64 }, { maxHeight: 360, viewportHeight: 800 });
  assert.ok(style.top < 720);
  assert.ok(style.top + style.maxHeight <= 792);
});
