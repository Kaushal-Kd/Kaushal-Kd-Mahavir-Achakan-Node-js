import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { damagedAccessoryHold, damagedAccessoryHoldDelta } from './damagedAccessoryHold.js';

const rentLine = (over = {}) => ({
  damaged: true,
  type: 'rent',
  accessory_id: 'acc-1',
  qty: 2,
  ...over,
});

describe('damagedAccessoryHold', () => {
  it('holds the line qty for a damaged rent accessory', () => {
    assert.deepEqual(damagedAccessoryHold(rentLine()), { accessoryId: 'acc-1', qty: 2 });
  });

  it('holds nothing for an undamaged line', () => {
    assert.equal(damagedAccessoryHold(rentLine({ damaged: false })), null);
  });

  it('holds only the affected quantity for partial damage or missing stock', () => {
    assert.deepEqual(damagedAccessoryHold(rentLine({ qty: 3, damaged_qty: 1 })), {
      accessoryId: 'acc-1',
      qty: 1,
    });
    assert.deepEqual(
      damagedAccessoryHold(
        rentLine({ qty: 3, damaged: false, missing: true, damaged_qty: 0, missing_qty: 1 })
      ),
      { accessoryId: 'acc-1', qty: 1 }
    );
  });

  it('treats the MySQL 0/1 tinyint the same as a boolean', () => {
    assert.equal(damagedAccessoryHold(rentLine({ damaged: 0 })), null);
    assert.deepEqual(damagedAccessoryHold(rentLine({ damaged: 1 })), {
      accessoryId: 'acc-1',
      qty: 2,
    });
  });

  it('holds nothing for a sell line — the sale already decremented qty', () => {
    assert.equal(damagedAccessoryHold(rentLine({ type: 'sell' })), null);
  });

  it('holds nothing for a line with no catalogue accessory', () => {
    assert.equal(damagedAccessoryHold(rentLine({ accessory_id: null })), null);
  });

  it('holds nothing for a zero-qty line', () => {
    assert.equal(damagedAccessoryHold(rentLine({ qty: 0 })), null);
  });
});

describe('damagedAccessoryHoldDelta', () => {
  it('adds the qty when a line is marked damaged', () => {
    const delta = damagedAccessoryHoldDelta([
      { before: rentLine({ damaged: false }), after: rentLine() },
    ]);
    assert.deepEqual([...delta], [['acc-1', 2]]);
  });

  it('gives it back when the line is unmarked', () => {
    const delta = damagedAccessoryHoldDelta([
      { before: rentLine(), after: rentLine({ damaged: false }) },
    ]);
    assert.deepEqual([...delta], [['acc-1', -2]]);
  });

  it('is a no-op when nothing about the line changed', () => {
    assert.equal(damagedAccessoryHoldDelta([{ before: rentLine(), after: rentLine() }]).size, 0);
  });

  it('nets to zero across a mark/unmark/mark/unmark cycle', () => {
    const off = rentLine({ damaged: false });
    const on = rentLine();
    const delta = damagedAccessoryHoldDelta([
      { before: off, after: on },
      { before: on, after: off },
      { before: off, after: on },
      { before: on, after: off },
    ]);
    assert.equal(delta.size, 0);
  });

  it('follows a qty edit on a line that stays damaged', () => {
    const delta = damagedAccessoryHoldDelta([
      { before: rentLine({ qty: 2 }), after: rentLine({ qty: 5 }) },
    ]);
    assert.deepEqual([...delta], [['acc-1', 3]]);
  });

  it('returns exactly what was taken across a mark, resize and unmark', () => {
    // This is the drift case: the line is marked at qty 2, edited up to 5, then
    // unmarked. Releasing the original 2 would leave 3 stranded and releasing 5
    // against a 2 hold would over-release, so the three steps have to sum to
    // zero for the accessory to end up exactly where it started.
    const steps = [
      { before: rentLine({ qty: 2, damaged: false }), after: rentLine({ qty: 2 }) },
      { before: rentLine({ qty: 2 }), after: rentLine({ qty: 5 }) },
      { before: rentLine({ qty: 5 }), after: rentLine({ qty: 5, damaged: false }) },
    ];

    // Applied one write at a time, the way the routes actually call it.
    let held = 0;
    for (const step of steps) held += damagedAccessoryHoldDelta([step]).get('acc-1') || 0;
    assert.equal(held, 0);

    // And in a single pass, the way an order edit batches them.
    assert.equal(damagedAccessoryHoldDelta(steps).size, 0);
  });

  it('releases the hold when a damaged line is deleted', () => {
    const delta = damagedAccessoryHoldDelta([{ before: rentLine(), after: null }]);
    assert.deepEqual([...delta], [['acc-1', -2]]);
  });

  it('moves the hold when a line is repointed at another accessory', () => {
    const delta = damagedAccessoryHoldDelta([
      { before: rentLine(), after: rentLine({ accessory_id: 'acc-2' }) },
    ]);
    assert.deepEqual(
      [...delta].sort(),
      [
        ['acc-1', -2],
        ['acc-2', 2],
      ].sort()
    );
  });

  it('releases the hold when a damaged rent line is switched to sell', () => {
    const delta = damagedAccessoryHoldDelta([
      { before: rentLine(), after: rentLine({ type: 'sell' }) },
    ]);
    assert.deepEqual([...delta], [['acc-1', -2]]);
  });

  it('sums multiple lines pointing at the same accessory', () => {
    const delta = damagedAccessoryHoldDelta([
      { before: rentLine({ damaged: false, qty: 3 }), after: rentLine({ qty: 3 }) },
      { before: rentLine({ damaged: false, qty: 4 }), after: rentLine({ qty: 4 }) },
    ]);
    assert.deepEqual([...delta], [['acc-1', 7]]);
  });

  it('takes nothing for a brand new undamaged line', () => {
    assert.equal(
      damagedAccessoryHoldDelta([{ before: null, after: rentLine({ damaged: false }) }]).size,
      0
    );
  });

  it('tolerates an empty or missing pair list', () => {
    assert.equal(damagedAccessoryHoldDelta([]).size, 0);
    assert.equal(damagedAccessoryHoldDelta(undefined).size, 0);
  });
});
