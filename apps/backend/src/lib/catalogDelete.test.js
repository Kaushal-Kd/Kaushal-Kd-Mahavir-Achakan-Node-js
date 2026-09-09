import assert from 'node:assert/strict';
import test from 'node:test';

import Knex from 'knex';

import { catalogPermanentDeleteBlockers, deleteCatalogItem, isCatalogItemActive } from './catalogDelete.js';

function queryFixture(results) {
  const db = Knex({ client: 'mysql2' });
  const queries = [];
  let index = 0;
  db.client.runner = (builder) => ({ run: async () => {
    queries.push(builder.toSQL());
    return results[index++] || [];
  } });
  return { db, queries };
}

test('only explicit false catalog flags are inactive', () => {
  for (const is_active of [false, 0, '0']) assert.equal(isCatalogItemActive({ is_active }), false);
  for (const is_active of [true, 1, '1', null, undefined]) assert.equal(isCatalogItemActive({ is_active }), true);
});

test('catalog delete rejects an unknown mode before starting any transaction', async () => {
  let transactions = 0;
  await assert.rejects(deleteCatalogItem({ transaction() { transactions += 1; } }, {
    shopId: 'shop-a', id: 'product-a', kind: 'product', mode: 'automatic',
  }), /Invalid catalog delete mode/);
  assert.equal(transactions, 0);
});

test('permanent-delete blockers cover active, booked, queued and in-washing catalog rows', async () => {
  const { db } = queryFixture([
    [{ catalog_id: 'booked', order_number: 'BOOK-7' }],
    [{ accessory_id: 'queued' }],
    [{ accessory_id: 'washing' }],
  ]);
  try {
    const rows = ['active', 'booked', 'queued', 'washing', 'completed'].map((id) => ({ id, is_active: id === 'active' }));
    const blockers = await catalogPermanentDeleteBlockers(db, 'shop-a', 'accessory', rows);
    assert.match(blockers.get('active'), /Deactivate.*first/);
    assert.match(blockers.get('booked'), /BOOK-7/);
    assert.match(blockers.get('queued'), /washing queue/);
    assert.match(blockers.get('washing'), /still in washing/);
    assert.equal(blockers.has('completed'), false);
  } finally { await db.destroy(); }
});

test('accessory deletion checks every booking line and scopes partial washing quantities within the shop', async () => {
  const { db, queries } = queryFixture([[], [], []]);
  try {
    await catalogPermanentDeleteBlockers(db, 'shop-a', 'accessory', [{ id: 'acc', is_active: false }]);
    assert.equal(queries.length, 3);
    assert.ok(queries[0].sql.includes('`line`.`shop_id` = ?'));
    assert.ok(queries[0].sql.includes('`booking`.`shop_id` = ?'));
    assert.ok(!queries[0].sql.includes('order_item_id'), 'Both product-linked and standalone accessories must be checked');
    assert.ok(queries[2].sql.includes('and (`status` = ? or COALESCE(qty_returned, 0) < qty)'));
    assert.deepEqual(queries[2].bindings, ['shop-a', 'acc', 'in_washing']);
  } finally { await db.destroy(); }
});

test('empty catalog selections perform no database query', async () => {
  const { db, queries } = queryFixture([]);
  try {
    assert.equal((await catalogPermanentDeleteBlockers(db, 'shop-a', 'product', [])).size, 0);
    assert.equal(queries.length, 0);
  } finally { await db.destroy(); }
});

test('a legacy product still marked washing is protected even without a linked washing row', async () => {
  const { db } = queryFixture([[], [], []]);
  try {
    const blockers = await catalogPermanentDeleteBlockers(db, 'shop-a', 'product', [{ id: 'legacy-washing', is_active: false, status: 'washing' }]);
    assert.match(blockers.get('legacy-washing'), /still in washing/);
  } finally { await db.destroy(); }
});
