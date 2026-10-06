import assert from 'node:assert/strict';
import test from 'node:test';

import { nextModalDragOffset } from './modalDrag.js';

test('drag offset follows the pointer with no viewport clamp', () => {
  const drag = { startOffsetX: 0, startOffsetY: 0, startX: 400, startY: 200 };
  assert.deepEqual(nextModalDragOffset(drag, -80, -40), { x: -480, y: -240 });
  assert.deepEqual(nextModalDragOffset(drag, 2000, 1400), { x: 1600, y: 1200 });
});

test('returns null when a drag is not active', () => {
  assert.equal(nextModalDragOffset(null, 10, 10), null);
});
