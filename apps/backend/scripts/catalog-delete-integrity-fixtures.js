import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import serviceDb from '../src/db/knex.js';
import { deleteAccessory } from '../src/modules/accessories/service.js';
import { bulkHardDeleteProductsByCode, deleteProduct, hardDeleteProductsByIds, previewBulkDeleteProductsByCode } from '../src/modules/products/service.js';

export async function runCatalogDeleteIntegrityFixtures({ db, shopId, createOrder, createOrderAccessory }) {
  const database = db.client.config.connection.database;
  assert.equal(process.env.WRS_TEST_MYSQL_INTEGRATION, '1');
  assert.equal(database, process.env.WRS_TEST_DB_NAME);
  assert.equal(database, serviceDb.client.config.connection.database);
  assert.match(database, /test/i, 'Catalog fixtures require the explicitly selected disposable database');

  const createCatalog = async (kind, is_active = true) => {
    const id = randomUUID();
    await db(kind === 'product' ? 'products' : 'accessories').insert({ id, shop_id: shopId,
      name: `Catalog deletion fixture ${id}`, code: `CAT-${id}`, qty: 3, is_active });
    return id;
  };
  const readCatalog = (kind, id) => db(kind === 'product' ? 'products' : 'accessories').where({ id, shop_id: shopId }).first();

  for (const [kind, remove] of [['product', deleteProduct], ['accessory', deleteAccessory]]) {
    const id = await createCatalog(kind);
    await assert.rejects(remove(shopId, id, 'permanent'), /Deactivate.*first/i);
    assert.equal(Boolean((await readCatalog(kind, id)).is_active), true);
    await assert.rejects(remove(randomUUID(), id, 'permanent'), /not found/i);
    assert.equal(Boolean((await readCatalog(kind, id)).is_active), true);

    const results = await Promise.all([remove(shopId, id), remove(shopId, id)]);
    assert.deepEqual(results.map((result) => result.mode), ['deactivated', 'deactivated']);
    assert.equal(Boolean((await readCatalog(kind, id)).is_active), false);
    assert.equal((await remove(shopId, id)).mode, 'deactivated', 'Lost deactivation response retry cannot become permanent');
    assert.ok(await readCatalog(kind, id));
    assert.equal((await remove(shopId, id, 'permanent')).mode, 'permanently_deleted');
    assert.equal(await readCatalog(kind, id), undefined);
  }

  const productId = await createCatalog('product');
  const accessoryId = await createCatalog('accessory');
  const standaloneAccessoryId = await createCatalog('accessory');
  const { orderId, itemId } = await createOrder({ productId });
  const accessoryLineId = await createOrderAccessory(orderId, accessoryId);
  const standaloneLineId = await createOrderAccessory(orderId, standaloneAccessoryId);
  await db('order_accessories').where({ id: accessoryLineId }).update({ order_item_id: itemId });
  await assert.rejects(deleteProduct(shopId, productId), /Active booking/i);
  await db('products').where({ id: productId }).update({ is_active: false });
  await deleteAccessory(shopId, accessoryId);
  await deleteAccessory(shopId, standaloneAccessoryId);
  const linesBefore = await db('order_accessories').whereIn('id', [accessoryLineId, standaloneLineId]).orderBy('id');
  for (const [id, remove] of [[productId, deleteProduct], [accessoryId, deleteAccessory], [standaloneAccessoryId, deleteAccessory]]) {
    await assert.rejects(remove(shopId, id, 'permanent'), /Active booking/i);
  }
  assert.deepEqual(await db('order_accessories').whereIn('id', [accessoryLineId, standaloneLineId]).orderBy('id'), linesBefore);
  assert.equal((await db('order_items').where({ id: itemId }).first()).product_id, productId);

  await db('orders').where({ id: orderId }).update({ status: 'returned' });
  const queueIds = [randomUUID(), randomUUID()];
  await db('washing_queue').insert([
    { id: queueIds[0], shop_id: shopId, item_kind: 'product', product_id: productId, qty: 1 },
    { id: queueIds[1], shop_id: shopId, item_kind: 'accessory', accessory_id: accessoryId, qty: 1 },
  ]);
  const queueBefore = await db('washing_queue').whereIn('id', queueIds).orderBy('id');
  await assert.rejects(deleteProduct(shopId, productId, 'permanent'), /washing queue/i);
  await assert.rejects(deleteAccessory(shopId, accessoryId, 'permanent'), /washing queue/i);
  assert.deepEqual(await db('washing_queue').whereIn('id', queueIds).orderBy('id'), queueBefore);
  assert.ok(await readCatalog('product', productId));
  assert.ok(await readCatalog('accessory', accessoryId));
  await db('washing_queue').whereIn('id', queueIds).delete();

  const jobId = randomUUID();
  const laundryProductId = randomUUID();
  const laundryAccessoryId = randomUUID();
  await db('laundry_jobs').insert({ id: jobId, shop_id: shopId, job_no: `CAT-${jobId}`, laundry_date: '2026-09-06' });
  await db('laundry_job_products').insert({ id: laundryProductId, shop_id: shopId, laundry_job_id: jobId,
    product_id: productId, product_name: 'Product in washing', qty: 1, status: 'in_washing' });
  await db('laundry_job_accessories').insert({ id: laundryAccessoryId, shop_id: shopId, laundry_job_id: jobId,
    accessory_id: accessoryId, accessory_name: 'Partially received accessory', qty: 3, qty_returned: 1, status: 'returned' });
  await assert.rejects(deleteProduct(shopId, productId, 'permanent'), /still in washing/i);
  await assert.rejects(deleteAccessory(shopId, accessoryId, 'permanent'), /still in washing/i);
  assert.equal((await db('laundry_job_accessories').where({ id: laundryAccessoryId }).first()).accessory_id, accessoryId);
  await db('laundry_job_products').where({ id: laundryProductId }).update({ status: 'returned' });
  await db('laundry_job_accessories').where({ id: laundryAccessoryId }).update({ qty_returned: 3 });
  await deleteProduct(shopId, productId, 'permanent');
  await deleteAccessory(shopId, accessoryId, 'permanent');
  assert.equal((await db('order_items').where({ id: itemId }).first()).product_id, null);
  assert.equal((await db('order_accessories').where({ id: accessoryLineId }).first()).accessory_id, null);
  assert.equal((await db('order_accessories').where({ id: accessoryLineId }).first()).name_snapshot, linesBefore.find((line) => line.id === accessoryLineId).name_snapshot);

  const activeId = await createCatalog('product');
  const inactiveId = await createCatalog('product', false);
  const activeCode = (await readCatalog('product', activeId)).code;
  const inactiveCode = (await readCatalog('product', inactiveId)).code;
  const preview = await previewBulkDeleteProductsByCode(shopId, { codes: [activeCode, inactiveCode] });
  assert.equal(preview.deletable.length, 1);
  assert.equal(preview.deletable[0].id, inactiveId);
  assert.match(preview.blocked[0].reason, /Deactivate.*first/i);
  const bulk = await bulkHardDeleteProductsByCode(shopId, { codes: [activeCode, inactiveCode] });
  assert.equal(bulk.deleted, 1);
  assert.equal(bulk.skipped_blocked, 1);
  assert.ok(await readCatalog('product', activeId));
  assert.equal(await readCatalog('product', inactiveId), undefined);
  const noMatches = await hardDeleteProductsByIds(shopId, [randomUUID()]);
  assert.equal(noMatches.deleted, 0, 'Unknown IDs are never counted as deleted');
  assert.equal(noMatches.skipped_not_found, 1);

  const reactivatedId = await createCatalog('product', false);
  const lock = await db.transaction();
  try {
    await lock('products').where({ id: reactivatedId, shop_id: shopId }).forUpdate().first();
    const deletion = deleteProduct(shopId, reactivatedId, 'permanent');
    const rejected = assert.rejects(deletion, /Deactivate.*first/i);
    await lock('products').where({ id: reactivatedId }).update({ is_active: true });
    await lock.commit();
    await rejected;
    assert.equal(Boolean((await readCatalog('product', reactivatedId)).is_active), true);
  } catch (error) {
    await lock.rollback();
    throw error;
  }
}
