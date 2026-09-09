import assert from 'node:assert/strict';
import test from 'node:test';

import { diffSnapshots, filterNoOpLineChanges } from './snapshotDiff.js';

test('diffSnapshots reports scalar field change', () => {
  const prev = { order: { pickup_name: 'Ali' } };
  const next = { order: { pickup_name: 'Hassan' } };
  const { changes, changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 1);
  assert.equal(changes[0].kind, 'modified');
  assert.match(changes[0].label, /Pickup name/i);
  assert.equal(changes[0].previous, 'Ali');
  assert.equal(changes[0].next, 'Hassan');
});

test('diffSnapshots reports item line rent change', () => {
  const id = 'line-1';
  const prev = { items: [{ id, code: 'P-1', product_name: 'Shirt', qty: 1, rent: 500 }] };
  const next = { items: [{ id, code: 'P-1', product_name: 'Shirt', qty: 1, rent: 600 }] };
  const { changes, changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 1);
  assert.match(changes[0].label, /Rent/i);
  assert.equal(changes[0].previous, '500');
  assert.equal(changes[0].next, '600');
});

test('diffSnapshots pairs single remove+add as product changed', () => {
  const prev = {
    items: [{ id: 'a', product_id: 'p1', product_name: 'Shirt', code: 'S1', qty: 1 }],
  };
  const next = {
    items: [{ id: 'b', product_id: 'p2', product_name: 'Sherwani', code: 'S2', qty: 1 }],
  };
  const { changes, changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 1);
  assert.equal(changes[0].kind, 'modified');
  assert.match(changes[0].label, /Product changed/i);
  assert.match(changes[0].previous, /Shirt/i);
  assert.match(changes[0].next, /Sherwani/i);
});

test('diffSnapshots treats string and number rent as equal', () => {
  const id = 'line-1';
  const prev = { items: [{ id, product_name: 'Shirt', rent: '500', qty: 1 }] };
  const next = { items: [{ id, product_name: 'Shirt', rent: 500, qty: 1 }] };
  const { changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 0);
});

test('diffSnapshots matches lines by product_id when id changes', () => {
  const prev = {
    items: [{ id: 'old-id', product_id: 'p1', product_name: 'Shirt', rent: 500, qty: 1 }],
  };
  const next = {
    items: [{ id: 'new-id', product_id: 'p1', product_name: 'Shirt', rent: 600, qty: 1 }],
  };
  const { changes, changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 1);
  assert.match(changes[0].label, /Rent/i);
  assert.equal(changes[0].previous, '500');
  assert.equal(changes[0].next, '600');
});

test('diffSnapshots CREATE treats null prev as additions', () => {
  const next = { order: { pickup_name: 'New' } };
  const { changeCount } = diffSnapshots(null, next);
  assert.ok(changeCount >= 1);
});

test('diffSnapshots reports one change when 25 lines identical except one rent', () => {
  const mkLine = (id, rent) => ({
    id,
    product_id: id,
    name_snapshot: `Product ${id}`,
    qty: 1,
    rent,
    discount: 0,
    type: 'rent',
    stage_flags: { item_to_collect: false, prepared: false, delivered: false, received: false },
  });
  const prev = {
    items: Array.from({ length: 25 }, (_, i) => mkLine(`line-${i}`, 500)),
    accessories: [],
  };
  const next = {
    items: Array.from({ length: 25 }, (_, i) => mkLine(`line-${i}`, i === 3 ? 600 : 500)),
    accessories: [],
  };
  const { changes, changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 1);
  assert.match(changes[0].label, /Rent/i);
});

test('diffSnapshots ignores stage_flags string false vs boolean false', () => {
  const id = 'line-1';
  const prev = {
    items: [
      {
        id,
        product_id: 'p1',
        name_snapshot: 'Shirt',
        qty: 1,
        rent: 500,
        stage_flags: { item_to_collect: 'false', prepared: false, delivered: false, received: false },
      },
    ],
  };
  const next = {
    items: [
      {
        id,
        product_id: 'p1',
        name_snapshot: 'Shirt',
        qty: 1,
        rent: 500,
        stage_flags: { item_to_collect: false, prepared: false, delivered: false, received: false },
      },
    ],
  };
  const { changeCount } = diffSnapshots(prev, next);
  assert.equal(changeCount, 0);
});

test('filterNoOpLineChanges removes identical display values', () => {
  const filtered = filterNoOpLineChanges([
    { path: 'a', label: 'A', previous: '500', next: '500', kind: 'modified' },
    { path: 'b', label: 'B', previous: '500', next: '600', kind: 'modified' },
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].path, 'b');
});
