import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterWashingQueue,
  filterWashingQueueByKind,
  groupLaundryAccessoriesByCategory,
  sortLaundryJobProductsByCode,
  sortWashingQueue,
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

test('laundry product rows sort A–Z by code with increasing numeric series', () => {
  const sorted = sortLaundryJobProductsByCode([
    { code: 'AN-0241[36]', name: 'anarkali' },
    { code: 'A-0010[38]', name: 'angrakhu' },
    { code: 'A-0002[40]', name: 'angrakhu' },
    { code: 'AA-2222[49]', name: 'angarkha' },
    { code: 'A-0001[36]', name: 'angrakhu' },
  ]);

  assert.deepEqual(
    sorted.map((row) => row.code),
    ['A-0001[36]', 'A-0002[40]', 'A-0010[38]', 'AA-2222[49]', 'AN-0241[36]']
  );
});

test('washing queue code sort uses the same A–Z numeric series', () => {
  const sorted = sortWashingQueue(
    [
      { id: '1', code: 'S-1176[36]', name: 'SERVANI' },
      { id: '2', code: 'A-0601[40]', name: 'ACHAKAN' },
      { id: '3', code: 'AN-0241[36]', name: 'ANARKALI' },
      { id: '4', code: 'A-0010[34]', name: 'ANGRAKHU' },
    ],
    'code'
  );

  assert.deepEqual(
    sorted.map((row) => row.code),
    ['A-0010[34]', 'A-0601[40]', 'AN-0241[36]', 'S-1176[36]']
  );
});
