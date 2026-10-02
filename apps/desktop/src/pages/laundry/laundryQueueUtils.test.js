import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterWashingQueue,
  filterWashingQueueByKind,
  groupLaundryAccessoriesByCategory,
  washingQueueItemKind,
} from './laundryQueueUtils.js';

test('groups washing accessories by category and keeps item detail', () => {
  const groups = groupLaundryAccessoriesByCategory([
    {
      rowId: '1',
      categoryId: 'jewellery',
      categoryLabel: 'Jewellery',
      name: 'Necklace',
      qty: 2,
      qtyReturned: 1,
      rate: 10,
    },
    {
      rowId: '2',
      categoryId: 'jewellery',
      categoryLabel: 'Jewellery',
      name: 'Earrings',
      qty: 1,
      rate: 10,
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Jewellery');
  assert.equal(groups[0].qty, 3);
  assert.equal(groups[0].qtyReturned, 1);
  assert.equal(groups[0].lineTotal, 30);
  assert.deepEqual(
    groups[0].rows.map((row) => row.name),
    ['Necklace', 'Earrings']
  );
});

test('washing queue kind treats missing item_kind as product', () => {
  assert.equal(washingQueueItemKind({ id: '1' }), 'product');
  assert.equal(washingQueueItemKind({ id: '2', item_kind: 'accessory' }), 'accessory');
});

test('washing queue kind filter returns only that category', () => {
  const items = [
    { id: '1', item_kind: 'product' },
    { id: '2', item_kind: 'accessory' },
    { id: '3' },
  ];
  assert.deepEqual(
    filterWashingQueueByKind(items, 'product').map((row) => row.id),
    ['1', '3']
  );
  assert.deepEqual(
    filterWashingQueueByKind(items, 'accessory').map((row) => row.id),
    ['2']
  );
});

test('washing queue search matches accessory category names', () => {
  const items = [
    { id: '1', name: 'Necklace', category_label: 'Jewellery' },
    { id: '2', name: 'Safaa', category_label: 'Headwear' },
  ];
  assert.deepEqual(
    filterWashingQueue(items, 'jewel').map((row) => row.id),
    ['1']
  );
});
