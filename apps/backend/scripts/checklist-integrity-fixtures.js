import assert from 'node:assert/strict';

import { parseStageFlagsJson } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import serviceDb from '../src/db/knex.js';
import {
  applyChecklistCommand,
  getOrder,
  listItemsToCollectLines,
} from '../src/modules/orders/service.js';

export async function runChecklistIntegrityFixtures({
  db,
  shopId,
  createProduct,
  createOrder,
  createAccessory,
  createOrderAccessory,
  paymentAccountId,
}) {
  const database = db.client.config.connection.database;
  if (
    process.env.WRS_TEST_MYSQL_INTEGRATION !== '1' ||
    database !== process.env.WRS_TEST_DB_NAME ||
    database !== serviceDb.client.config.connection.database ||
    !/test/i.test(database)
  ) {
    throw new Error('Checklist fixtures require the explicitly selected disposable database');
  }
  const productId = await createProduct(1);
  const { orderId, itemId } = await createOrder({ productId });
  const accessoryId = await createAccessory(3);
  const accessoryLineId = await createOrderAccessory(orderId, accessoryId, { delivered: true });
  await db('order_accessories').where({ id: accessoryLineId }).update({ qty: 3 });
  const command = async (extra = {}) => ({
    idempotency_key: uuid(),
    expected_state_token: (await getOrder(shopId, orderId)).checklist_state_token,
    stage_updates: [],
    condition_updates: [],
    ...extra,
  });
  const condition = {
    item_id: accessoryLineId,
    item_type: 'accessory',
    damaged: true,
    condition_qty: 1,
    damage_charge: 20,
  };
  const snapshot = async () => ({
    line: await db('order_accessories').where({ id: accessoryLineId }).first(),
    stock: await db('accessories').where({ id: accessoryId }).first(),
    order: await db('orders').where({ id: orderId }).first(),
    charges: await db('security_charges').where({ order_id: orderId }).orderBy('id'),
    washing: await db('washing_queue').where({ order_id: orderId }).orderBy('id'),
    logs: await db('order_edit_logs').where({ order_id: orderId }).orderBy('id'),
  });
  const assertRollback = async (payload, pattern) => {
    const before = await snapshot();
    await assert.rejects(applyChecklistCommand(shopId, orderId, payload, null), pattern);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await db('sync_queue').where({ id: payload.idempotency_key }).first(), undefined);
  };
  for (const condition_qty of [0, 4]) {
    await assertRollback(await command({ condition_updates: [{ ...condition, condition_qty }] }), /quantity/i);
  }
  await assertRollback(await command({ condition_updates: [{ ...condition, missing: true }] }), /cannot be selected together/i);
  await assertRollback(
    await command({
      condition_updates: [condition],
      combined_assessment: {
        amount: 20,
        remarks: 'Damage: one accessory',
        payment_account_id: paymentAccountId,
      },
      stage_updates: [{ item_id: uuid(), item_type: 'item', field: 'prepared', value: true }],
    }),
    /not found/i
  );

  for (const table of ['security_charges', 'washing_queue']) {
    await db.raw(
      `CREATE TRIGGER wrs_test_checklist_failure BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced checklist failure'`
    );
    try {
      await assertRollback(
        await command({
          condition_updates: [condition],
          stage_updates: [
            { item_id: accessoryLineId, item_type: 'accessory', field: 'received', value: true },
          ],
        }),
        /forced checklist failure/
      );
    } finally {
      await db.raw('DROP TRIGGER wrs_test_checklist_failure');
    }
  }
  const payload = await command({
    condition_updates: [condition],
    stage_updates: [
      { item_id: accessoryLineId, item_type: 'accessory', field: 'received', value: true },
    ],
    combined_assessment: {
      amount: 20,
      remarks: 'Damage: one accessory',
      payment_account_id: paymentAccountId,
    },
  });
  const saved = await applyChecklistCommand(shopId, orderId, payload, null);
  assert.equal(saved.replayed, false);
  assert.equal(
    parseStageFlagsJson(
      saved.order.accessories.find((row) => row.id === accessoryLineId).stage_flags
    ).received,
    true
  );
  const after = await snapshot();
  const replay = await applyChecklistCommand(shopId, orderId, payload, null);
  assert.equal(replay.replayed, true);
  assert.deepEqual(await snapshot(), after);
  assert.equal(
    Number((await db('payments').where({ order_id: orderId }).count({ n: '*' }).first()).n),
    0
  );
  assert.equal(
    Number(
      (
        await db('security_charge_operations')
          .where({ order_id: orderId })
          .count({ n: '*' })
          .first()
      ).n
    ),
    0
  );
  await assert.rejects(
    applyChecklistCommand(shopId, orderId, { ...payload, idempotency_key: uuid() }, null),
    { statusCode: 409 }
  );
  await assert.rejects(
    applyChecklistCommand(
      shopId,
      orderId,
      { ...payload, combined_assessment: { amount: 40 } },
      null
    ),
    { statusCode: 409 }
  );
  await assert.rejects(applyChecklistCommand(uuid(), orderId, payload, null), { statusCode: 404 });
  await assert.rejects(applyChecklistCommand(shopId, orderId, payload, uuid()), {
    statusCode: 409,
  });

  await applyChecklistCommand(
    shopId,
    orderId,
    await command({
      condition_updates: [{ item_id: accessoryLineId, item_type: 'accessory', condition_qty: 2 }],
    }),
    null
  );
  assert.equal(
    Number((await db('washing_queue').where({ order_accessory_id: accessoryLineId }).first()).qty),
    1
  );
  await applyChecklistCommand(
    shopId,
    orderId,
    await command({
      condition_updates: [
        { item_id: accessoryLineId, item_type: 'accessory', missing: true, condition_qty: 1 },
      ],
    }),
    null
  );
  const missing = await db('order_accessories').where({ id: accessoryLineId }).first();
  assert.equal(Number(missing.damaged_qty), 0);
  assert.equal(Number(missing.missing_qty), 1);
  assert.equal(
    Number((await db('washing_queue').where({ order_accessory_id: accessoryLineId }).first()).qty),
    2
  );
  await applyChecklistCommand(
    shopId,
    orderId,
    await command({
      condition_updates: [
        {
          item_id: accessoryLineId,
          item_type: 'accessory',
          damaged: false,
          missing: false,
          condition_qty: 0,
        },
      ],
    }),
    null
  );
  assert.equal(
    Number((await db('washing_queue').where({ order_accessory_id: accessoryLineId }).first()).qty),
    3
  );

  const selected = await listItemsToCollectLines(shopId, {
    page: 1,
    per_page: 500,
    order_ids: [orderId],
    skip_enrich: true,
  });
  // A separate clean booking is used because accessory return may advance the first order's status.
  const clean = await createOrder({ productId: await createProduct(1) });
  await db('orders').where({ id: clean.orderId }).update({ status: 'booked' });
  await db('order_items')
    .where({ id: clean.itemId })
    .update({
      stage_flags: JSON.stringify({
        item_to_collect: false,
        prepared: false,
        delivered: false,
        received: false,
      }),
    });
  const report = await listItemsToCollectLines(shopId, {
    page: 1,
    per_page: 500,
    order_ids: [clean.orderId],
    skip_enrich: true,
  });
  assert.ok(Array.isArray(selected.data));
  const reportRow = report.data.find((row) => row.id === clean.itemId);
  assert.ok(reportRow?.checklist_state_token);
  await applyChecklistCommand(
    shopId,
    clean.orderId,
    {
      idempotency_key: uuid(),
      expected_state_token: reportRow.checklist_state_token,
      stage_updates: [
        { item_id: clean.itemId, item_type: 'item', field: 'item_to_collect', value: true },
      ],
    },
    null
  );
  assert.equal(
    parseStageFlagsJson((await db('order_items').where({ id: clean.itemId }).first()).stage_flags)
      .item_to_collect,
    true
  );
  const concurrent = {
    idempotency_key: uuid(),
    expected_state_token: (await getOrder(shopId, clean.orderId)).checklist_state_token,
    stage_updates: [{ item_id: clean.itemId, item_type: 'item', field: 'prepared', value: true }],
  };
  const concurrentResults = await Promise.all([
    applyChecklistCommand(shopId, clean.orderId, concurrent, null),
    applyChecklistCommand(shopId, clean.orderId, concurrent, null),
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.replayed).sort(), [false, true]);
  const receivedOrder = await getOrder(shopId, clean.orderId);
  const receivedLine = receivedOrder.items.find((row) => row.id === clean.itemId);
  await applyChecklistCommand(
    shopId,
    clean.orderId,
    {
      idempotency_key: uuid(),
      expected_state_token: receivedOrder.checklist_state_token,
      stage_updates: ['delivered', 'received'].map((field) => ({
        item_id: clean.itemId,
        item_type: 'item',
        field,
        value: true,
        expected_product_id: receivedLine.product_id,
        expected_line_version: Number(receivedLine.replacement_version || 0),
      })),
    },
    null
  );
  assert.ok(await db('washing_queue').where({ order_item_id: clean.itemId }).first());
  await applyChecklistCommand(
    shopId,
    clean.orderId,
    {
      idempotency_key: uuid(),
      expected_state_token: (await getOrder(shopId, clean.orderId)).checklist_state_token,
      condition_updates: [{ item_id: clean.itemId, item_type: 'item', damaged: true }],
    },
    null
  );
  assert.equal(await db('washing_queue').where({ order_item_id: clean.itemId }).first(), undefined);
  assert.equal(
    parseStageFlagsJson((await db('order_items').where({ id: clean.itemId }).first()).stage_flags)
      .received,
    true
  );
  assert.ok(itemId);
  process.stdout.write(
    'Checklist atomicity, replay, stale state, quantity transitions and report-token fixtures passed.\n'
  );
}
