import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Knex from 'knex';
import { parseStageFlagsJson } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

const database = String(process.env.WRS_TEST_DB_NAME || '').trim();
if (process.env.WRS_TEST_MYSQL_INTEGRATION !== '1') {
  throw new Error('Set WRS_TEST_MYSQL_INTEGRATION=1 to run the disposable-MySQL transaction tests');
}
if (!/(test|disposable|temporary|tmp)/i.test(database)) {
  throw new Error('WRS_TEST_DB_NAME must clearly identify a disposable test database');
}
if (database === process.env.WRS_TEST_SOURCE_DB_NAME || database === process.env.DB_NAME) {
  throw new Error('The test database must be different from the configured application database');
}

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.WRS_TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.WRS_TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.WRS_TEST_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.WRS_TEST_DB_PASSWORD || '';
process.env.DB_NAME = database;
process.env.DB_POOL_MIN = '0';
process.env.DB_POOL_MAX = '4';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = resolve(backendRoot, 'src', 'db', 'migrations');
const db = Knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
  },
  pool: {
    min: 0,
    max: 4,
    afterCreate(conn, done) {
      // Match application connections: driver timezone alone does not set MySQL TIMESTAMP semantics.
      conn.query("SET time_zone = '+00:00'", (error) => done(error, conn));
    },
  },
  migrations: { directory: migrationDirectory, loadExtensions: ['.js'] },
});

const ids = {
  shop: uuid(),
  customer: uuid(),
  paymentAccount: uuid(),
  securityAccount: uuid(),
  incomeAccount: uuid(),
  expenseAccount: uuid(),
};
let billNo = 900_000;

async function createProduct(qty) {
  const id = uuid();
  await db('products').insert({
    id,
    shop_id: ids.shop,
    name: `Integration product ${billNo}`,
    code: `INT-${billNo}`,
    qty,
    status: 'available',
  });
  return id;
}

async function createAccessory(qty) {
  const id = uuid();
  const categoryId = uuid();
  await db('categories').insert({
    id: categoryId,
    shop_id: ids.shop,
    label: `Washable ${id.slice(0, 8)}`,
    category_type: 'accessory',
    is_washable: true,
  });
  await db('accessories').insert({
    id,
    shop_id: ids.shop,
    name: `Integration accessory ${billNo}`,
    code: `IA-${id.slice(0, 8)}`,
    qty,
    default_type: 'rent',
    category_id: categoryId,
    image_url: 'https://images.test/integration-accessory.jpg',
  });
  return id;
}

async function createOrderAccessory(
  orderId,
  accessoryId,
  { name = 'Integration accessory line', delivered = false, missing = false } = {}
) {
  const id = uuid();
  await db('order_accessories').insert({
    id,
    order_id: orderId,
    shop_id: ids.shop,
    accessory_id: accessoryId,
    name_snapshot: name,
    qty: 1,
    type: 'rent',
    given_status: 'regular',
    missing,
    stage_flags: JSON.stringify({ prepared: true, delivered, received: false }),
  });
  return id;
}

async function createOrder({ productId = null, prepared = false } = {}) {
  billNo += 1;
  const orderId = uuid();
  const itemId = uuid();
  await db('orders').insert({
    id: orderId,
    shop_id: ids.shop,
    customer_id: ids.customer,
    order_number: `INT-${billNo}`,
    bill_no: billNo,
    order_type: 'rent',
    booking_date: '2026-08-15',
    pickup_date: '2026-08-16',
    return_date: '2026-08-18',
    subtotal: 100,
    total_amount: 100,
    balance: 100,
    status: 'ready_for_delivery',
  });
  await db('order_items').insert({
    id: itemId,
    order_id: orderId,
    shop_id: ids.shop,
    product_id: productId,
    name_snapshot: `Integration line ${billNo}`,
    qty: 1,
    price: 100,
    line_total: 100,
    type: 'rent',
    stage_flags: JSON.stringify({
      item_to_collect: true,
      prepared,
      delivered: false,
      received: false,
    }),
  });
  return { orderId, itemId };
}

function settlementPayload(overrides = {}) {
  return {
    idempotency_key: uuid(),
    discount_total: 0,
    deposit_amount: 0,
    security_status: 'unpaid',
    security_amount: 0,
    security_account_id: null,
    receive_amount: 0,
    payment_account_id: null,
    payment_date: '2026-08-15',
    delivery_remark: 'MySQL integration test',
    stage_updates: [],
    ...overrides,
  };
}

function returnSettlementPayload(overrides = {}) {
  return {
    idempotency_key: uuid(),
    condition_collect_amount: 0,
    condition_retain_amount: 0,
    discount_total: 0,
    security_refund_amount: 0,
    refund_via: null,
    refund_payment_account_id: null,
    refund_security_account_id: null,
    receive_amount: 0,
    payment_account_id: null,
    payment_date: '2026-08-15',
    return_remark: 'MySQL return integration test',
    security_charge_remarks: null,
    reminder: null,
    stage_updates: [],
    ...overrides,
  };
}

async function assertSettlementRollback(settleOrderDelivery, orderId, payload, pattern) {
  await assert.rejects(() => settleOrderDelivery(ids.shop, orderId, payload, null), pattern);
  const paymentCount = await db('payments')
    .where({ order_id: orderId, is_deleted: false })
    .count({ n: '*' })
    .first();
  assert.equal(Number(paymentCount.n), 0);
  if (payload.idempotency_key) {
    const syncCount = await db('sync_queue')
      .where({ id: payload.idempotency_key })
      .count({ n: '*' })
      .first();
    assert.equal(Number(syncCount.n), 0);
  }
}

async function runAtomicSettlementTests(settleOrderDelivery) {
  const availableProduct = await createProduct(1);
  const successOrder = await createOrder({ productId: availableProduct, prepared: true });
  await db('orders').where({ id: successOrder.orderId }).update({ deposit_amount: 20 });
  const successPayload = settlementPayload({
    discount_total: 10,
    deposit_amount: 20,
    security_status: 'paid',
    security_amount: 20,
    security_account_id: ids.securityAccount,
    receive_amount: 50,
    payment_account_id: ids.paymentAccount,
    stage_updates: [
      { item_id: successOrder.itemId, item_type: 'item', field: 'delivered', value: true },
    ],
  });
  const first = await settleOrderDelivery(ids.shop, successOrder.orderId, successPayload, null);
  assert.equal(first.replayed, false);
  assert.equal(Number(first.order.discount_total), 10);
  assert.equal(Number(first.order.balance), 40);
  let paymentCount = await db('payments')
    .where({ order_id: successOrder.orderId, is_deleted: false })
    .count({ n: '*' })
    .first();
  assert.equal(Number(paymentCount.n), 2);

  const replay = await settleOrderDelivery(ids.shop, successOrder.orderId, successPayload, null);
  assert.equal(replay.replayed, true);
  paymentCount = await db('payments')
    .where({ order_id: successOrder.orderId, is_deleted: false })
    .count({ n: '*' })
    .first();
  assert.equal(Number(paymentCount.n), 2);

  const availableAccessory = await createAccessory(1);
  const availableAccessoryOrder = await createOrder();
  const availableAccessoryLineId = await createOrderAccessory(
    availableAccessoryOrder.orderId,
    availableAccessory
  );
  const availableAccessoryPayload = settlementPayload({
    receive_amount: 25,
    payment_account_id: ids.paymentAccount,
    stage_updates: [
      {
        item_id: availableAccessoryLineId,
        item_type: 'accessory',
        field: 'delivered',
        value: true,
      },
    ],
  });
  const accessoryResult = await settleOrderDelivery(
    ids.shop,
    availableAccessoryOrder.orderId,
    availableAccessoryPayload,
    null
  );
  assert.equal(accessoryResult.replayed, false);
  const accessoryPaymentCount = await db('payments')
    .where({ order_id: availableAccessoryOrder.orderId, is_deleted: false })
    .count({ n: '*' })
    .first();
  assert.equal(Number(accessoryPaymentCount.n), 1);
  const deliveredAccessoryLine = await db('order_accessories')
    .where({ id: availableAccessoryLineId })
    .first('stage_flags');
  assert.equal(parseStageFlagsJson(deliveredAccessoryLine.stage_flags).delivered, true);

  const invalidAccountOrder = await createOrder();
  await assertSettlementRollback(
    settleOrderDelivery,
    invalidAccountOrder.orderId,
    settlementPayload({ receive_amount: 10, payment_account_id: uuid() }),
    /Unknown or inactive payment account/
  );

  const excessOrder = await createOrder();
  await assertSettlementRollback(
    settleOrderDelivery,
    excessOrder.orderId,
    settlementPayload({ receive_amount: 101, payment_account_id: ids.paymentAccount }),
    /cannot exceed pending amount/i
  );

  const unavailableProduct = await createProduct(0);
  const unavailableProductOrder = await createOrder({
    productId: unavailableProduct,
    prepared: true,
  });
  await assertSettlementRollback(
    settleOrderDelivery,
    unavailableProductOrder.orderId,
    settlementPayload({
      stage_updates: [
        {
          item_id: unavailableProductOrder.itemId,
          item_type: 'item',
          field: 'delivered',
          value: true,
        },
      ],
    }),
    /Cannot mark Delivered/
  );

  const unavailableAccessory = await createAccessory(0);
  const unavailableAccessoryOrder = await createOrder();
  const orderAccessoryId = await createOrderAccessory(
    unavailableAccessoryOrder.orderId,
    unavailableAccessory,
    { name: 'Unavailable integration accessory' }
  );
  await assertSettlementRollback(
    settleOrderDelivery,
    unavailableAccessoryOrder.orderId,
    settlementPayload({
      stage_updates: [
        { item_id: orderAccessoryId, item_type: 'accessory', field: 'delivered', value: true },
      ],
    }),
    /accessory is NOT AVAILABLE/
  );
}

async function runAtomicReturnSettlementTests(settleOrderReturn) {
  const productId = await createProduct(1);
  const accessoryId = await createAccessory(1);
  const order = await createOrder({ productId, prepared: true });
  await db('order_items')
    .where({ id: order.itemId })
    .update({
      stage_flags: JSON.stringify({
        item_to_collect: true,
        prepared: true,
        delivered: true,
        received: false,
      }),
    });
  const accessoryLineId = await createOrderAccessory(order.orderId, accessoryId, {
    delivered: true,
  });
  const payload = returnSettlementPayload({
    receive_amount: 25,
    payment_account_id: ids.paymentAccount,
    stage_updates: [
      { item_id: order.itemId, item_type: 'item', field: 'received', value: true },
      { item_id: accessoryLineId, item_type: 'accessory', field: 'received', value: true },
    ],
  });
  await settleOrderReturn(ids.shop, order.orderId, payload, null);
  const payments = await db('payments')
    .where({ order_id: order.orderId, is_deleted: false })
    .select('id', 'amount', 'category');
  assert.equal(payments.length, 1);
  assert.equal(Number(payments[0].amount), 25);
  const receivedLine = await db('order_accessories')
    .where({ id: accessoryLineId })
    .first('stage_flags');
  assert.equal(parseStageFlagsJson(receivedLine.stage_flags).received, true);
  const washingRow = await db('washing_queue')
    .where({ order_accessory_id: accessoryLineId, item_kind: 'accessory' })
    .first('product_code', 'product_name', 'image_url');
  assert.equal(washingRow.product_code, null);
  assert.ok(washingRow.product_name);
  assert.equal(washingRow.image_url, 'https://images.test/integration-accessory.jpg');
  assert.ok(
    await db('washing_queue')
      .where({ order_item_id: order.itemId, item_kind: 'product' })
      .first('id')
  );

  const damagedProductId = await createProduct(1);
  await db('products').where({ id: damagedProductId }).update({ price_sell: 40 });
  const damagedOrder = await createOrder({ productId: damagedProductId, prepared: true });
  await db('order_items')
    .where({ id: damagedOrder.itemId })
    .update({
      stage_flags: JSON.stringify({
        item_to_collect: true,
        prepared: true,
        delivered: true,
        received: false,
      }),
    });
  await db('orders').where({ id: damagedOrder.orderId }).update({ deposit_amount: 30 });
  await db('payments').insert({
    id: uuid(),
    shop_id: ids.shop,
    order_id: damagedOrder.orderId,
    customer_id: ids.customer,
    payment_type: 'cash',
    category: 'deposit',
    amount: 30,
    payment_date: '2026-08-15',
    security_account_id: ids.securityAccount,
  });
  await settleOrderReturn(
    ids.shop,
    damagedOrder.orderId,
    returnSettlementPayload({
      charge_payment_account_id: ids.paymentAccount,
      condition_collect_amount: 10,
      condition_retain_amount: 30,
      condition_updates: [{ item_id: damagedOrder.itemId, item_type: 'item', condition: 'damage' }],
      stage_updates: [
        { item_id: damagedOrder.itemId, item_type: 'item', field: 'received', value: true },
      ],
    }),
    null
  );
  const damagedLine = await db('order_items')
    .where({ id: damagedOrder.itemId })
    .first('damaged', 'missing', 'damage_charge', 'stage_flags');
  assert.equal(Boolean(damagedLine.damaged), true);
  assert.equal(Boolean(damagedLine.missing), false);
  assert.equal(Number(damagedLine.damage_charge), 40);
  assert.equal(parseStageFlagsJson(damagedLine.stage_flags).received, true);
  assert.equal(
    await db('washing_queue').where({ order_item_id: damagedOrder.itemId }).first(),
    undefined
  );
  const damageCharges = await db('security_charges')
    .where({ order_id: damagedOrder.orderId, condition_kind: 'damage', status: 'pending' })
    .orderBy('funding_source')
    .select('amount', 'remarks', 'funding_source');
  assert.equal(damageCharges.length, 1);
  assert.equal(Number(damageCharges[0].amount), 40);
  const funding = await db('security_charge_operations')
    .where({ order_id: damagedOrder.orderId })
    .orderBy('kind');
  assert.deepEqual(
    funding.map((row) => [row.kind, Number(row.amount)]),
    [
      ['collect', 10],
      ['retain', 30],
    ]
  );
  assert.equal(
    funding.some((row) => row.income_entry_id),
    false
  );
  assert.ok(damageCharges.every((row) => String(row.remarks).startsWith('Damage · ')));

  const blockedAccessory = await createAccessory(1);
  const blockedOrder = await createOrder();
  const blockedLineId = await createOrderAccessory(blockedOrder.orderId, blockedAccessory, {
    delivered: true,
    missing: true,
  });
  await assertSettlementRollback(
    settleOrderReturn,
    blockedOrder.orderId,
    returnSettlementPayload({
      receive_amount: 20,
      payment_account_id: ids.paymentAccount,
      stage_updates: [
        { item_id: blockedLineId, item_type: 'accessory', field: 'received', value: true },
      ],
    }),
    /marked Missing/
  );
  const blockedLine = await db('order_accessories')
    .where({ id: blockedLineId })
    .first('stage_flags');
  assert.equal(parseStageFlagsJson(blockedLine.stage_flags).received, false);
  assert.equal(
    await db('washing_queue').where({ order_accessory_id: blockedLineId }).first(),
    undefined
  );

  const invalidAccountOrder = await createOrder();
  await assertSettlementRollback(
    settleOrderReturn,
    invalidAccountOrder.orderId,
    returnSettlementPayload({ receive_amount: 10, payment_account_id: uuid() }),
    /Unknown or inactive payment account/
  );

  const excessOrder = await createOrder();
  await assertSettlementRollback(
    settleOrderReturn,
    excessOrder.orderId,
    returnSettlementPayload({ receive_amount: 101, payment_account_id: ids.paymentAccount }),
    /cannot exceed pending amount/i
  );

  const refundAccessory = await createAccessory(1);
  const refundOrder = await createOrder();
  const refundLineId = await createOrderAccessory(refundOrder.orderId, refundAccessory, {
    delivered: true,
  });
  await db('orders').where({ id: refundOrder.orderId }).update({ deposit_amount: 30 });
  await db('payments').insert({
    id: uuid(),
    shop_id: ids.shop,
    order_id: refundOrder.orderId,
    customer_id: ids.customer,
    payment_type: 'cash',
    category: 'deposit',
    amount: 30,
    payment_date: '2026-08-15',
    security_account_id: ids.securityAccount,
  });
  const refundPayload = returnSettlementPayload({
    security_refund_amount: 20,
    refund_via: 'security',
    refund_security_account_id: ids.securityAccount,
    reminder: { reminder_date: '2026-08-19', reminder_time: '9:00 AM' },
    stage_updates: [
      { item_id: refundLineId, item_type: 'accessory', field: 'received', value: true },
    ],
  });
  const refundResult = await settleOrderReturn(ids.shop, refundOrder.orderId, refundPayload, null);
  assert.ok(refundResult.payments.refund_payment_id);
  assert.ok(refundResult.reminder_id);
  const returnCharge = await db('security_charges')
    .where({ order_id: refundOrder.orderId, source: 'return_modal', status: 'pending' })
    .first('amount');
  assert.equal(returnCharge, undefined);
  const refundOrderRow = await db('orders')
    .where({ id: refundOrder.orderId })
    .first('deposit_returned');
  assert.equal(Boolean(refundOrderRow.deposit_returned), false);
  const replay = await settleOrderReturn(ids.shop, refundOrder.orderId, refundPayload, null);
  assert.equal(replay.replayed, true);
  assert.equal(replay.reminder_id, refundResult.reminder_id);
  assert.equal(
    Number(
      (
        await db('payments')
          .where({ order_id: refundOrder.orderId, category: 'deposit_refund' })
          .count({ n: '*' })
          .first()
      ).n
    ),
    1
  );
  await assert.rejects(
    settleOrderReturn(
      ids.shop,
      refundOrder.orderId,
      { ...refundPayload, security_refund_amount: 1 },
      null
    ),
    { statusCode: 409 }
  );

  const partialAccessoryId = await createAccessory(3);
  const partialOrder = await createOrder();
  const partialLineId = await createOrderAccessory(partialOrder.orderId, partialAccessoryId, {
    delivered: true,
  });
  await db('order_accessories').where({ id: partialLineId }).update({ qty: 3 });
  await settleOrderReturn(
    ids.shop,
    partialOrder.orderId,
    returnSettlementPayload({
      condition_updates: [
        {
          item_id: partialLineId,
          item_type: 'accessory',
          condition: 'damage',
          condition_qty: 1,
          charge_amount: 5,
        },
      ],
      stage_updates: [
        { item_id: partialLineId, item_type: 'accessory', field: 'received', value: true },
      ],
    }),
    null
  );
  const partialLine = await db('order_accessories').where({ id: partialLineId }).first();
  assert.equal(Number(partialLine.damaged_qty), 1);
  assert.equal(Number(partialLine.missing_qty), 0);
  assert.equal(parseStageFlagsJson(partialLine.stage_flags).received, true);
  assert.equal(
    Number(
      (await db('payments').where({ order_id: partialOrder.orderId }).count({ n: '*' }).first()).n
    ),
    0,
    'assessment without explicit collection is not cash'
  );

  const missingAccessoryId = await createAccessory(3);
  const missingOrder = await createOrder();
  const missingLineId = await createOrderAccessory(missingOrder.orderId, missingAccessoryId, {
    delivered: true,
  });
  await db('order_accessories').where({ id: missingLineId }).update({ qty: 3 });
  await settleOrderReturn(
    ids.shop,
    missingOrder.orderId,
    returnSettlementPayload({
      condition_updates: [
        {
          item_id: missingLineId,
          item_type: 'accessory',
          condition: 'missing',
          condition_qty: 1,
          charge_amount: 5,
        },
      ],
      stage_updates: [
        { item_id: missingLineId, item_type: 'accessory', field: 'received', value: true },
      ],
    }),
    null
  );
  const missingLine = await db('order_accessories').where({ id: missingLineId }).first();
  assert.equal(Number(missingLine.missing_qty), 1);
  assert.equal(Number(missingLine.damaged_qty), 0);
  assert.equal(parseStageFlagsJson(missingLine.stage_flags).received, true);
  assert.equal(
    Number((await db('washing_queue').where({ order_accessory_id: missingLineId }).first()).qty),
    2,
    'only the two returned units enter washing'
  );

  const failureProductId = await createProduct(1);
  const failureOrder = await createOrder({ productId: failureProductId, prepared: true });
  await db('order_items')
    .where({ id: failureOrder.itemId })
    .update({
      stage_flags: JSON.stringify({
        item_to_collect: true,
        prepared: true,
        delivered: true,
        received: false,
      }),
    });
  await db.raw('DROP TRIGGER IF EXISTS wrs_test_fail_washing_insert');
  await db.raw(`
    CREATE TRIGGER wrs_test_fail_washing_insert
    BEFORE INSERT ON washing_queue
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced washing insert failure'
  `);
  try {
    await assertSettlementRollback(
      settleOrderReturn,
      failureOrder.orderId,
      returnSettlementPayload({
        receive_amount: 25,
        payment_account_id: ids.paymentAccount,
        stage_updates: [
          { item_id: failureOrder.itemId, item_type: 'item', field: 'received', value: true },
        ],
      }),
      /forced washing insert failure/
    );
  } finally {
    await db.raw('DROP TRIGGER IF EXISTS wrs_test_fail_washing_insert');
  }
  const failureLine = await db('order_items')
    .where({ id: failureOrder.itemId })
    .first('stage_flags');
  assert.equal(parseStageFlagsJson(failureLine.stage_flags).received, false);
  assert.equal(
    await db('washing_queue').where({ order_item_id: failureOrder.itemId }).first(),
    undefined
  );
}

async function runConcurrentDocumentNumberTests(createIncomeEntry, createExpenseEntry) {
  const incomeRows = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createIncomeEntry(ids.shop, null, {
        income_account_id: ids.incomeAccount,
        payment_account_id: ids.paymentAccount,
        name: `Concurrent income ${index}`,
        entry_date: '2026-08-15',
        amount: 1,
        details: 'Concurrent number allocation test',
      })
    )
  );
  const expenseRows = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createExpenseEntry(ids.shop, null, {
        expense_account_id: ids.expenseAccount,
        payment_account_id: ids.paymentAccount,
        name: `Concurrent expense ${index}`,
        entry_date: '2026-08-15',
        amount: 1,
        details: 'Concurrent number allocation test',
        image_urls: [],
      })
    )
  );

  for (const rows of [incomeRows, expenseRows]) {
    const numbers = rows.map((row) => Number(row.bill_no)).sort((a, b) => a - b);
    assert.equal(new Set(numbers).size, rows.length);
    for (let index = 1; index < numbers.length; index += 1) {
      assert.equal(numbers[index], numbers[index - 1] + 1);
    }
  }
}

async function runCorrectiveMigrationTests() {
  const migration =
    await import('../src/db/migrations/20261015110000_transaction_module_integrity_fixes.js');
  const accessoryId = await createAccessory(1);
  const order = await createOrder();
  const orderAccessoryId = uuid();
  await db('order_accessories').insert({
    id: orderAccessoryId,
    order_id: order.orderId,
    shop_id: ids.shop,
    accessory_id: accessoryId,
    name_snapshot: 'Rollback accessory',
    qty: 1,
    type: 'rent',
  });
  const queueId = uuid();
  await db('washing_queue').insert({
    id: queueId,
    shop_id: ids.shop,
    item_kind: 'accessory',
    product_id: null,
    accessory_id: accessoryId,
    order_id: order.orderId,
    order_accessory_id: orderAccessoryId,
    product_name: 'Rollback accessory',
    qty: 1,
  });

  await migration.down(db);
  assert.equal(await db('washing_queue').where({ id: queueId }).first(), undefined);

  const incomeId = uuid();
  const expenseId = uuid();
  await db('income_entries').insert({
    id: incomeId,
    shop_id: ids.shop,
    bill_no: null,
    income_number: null,
    income_account_id: 'integration-income',
    payment_account_id: ids.paymentAccount,
    name: 'Integration income',
    entry_date: '2026-08-15',
    amount: 1,
    details: 'Backfill test',
  });
  await db('expense_entries').insert({
    id: expenseId,
    shop_id: ids.shop,
    bill_no: null,
    expense_number: null,
    expense_account_id: 'integration-expense',
    payment_account_id: ids.paymentAccount,
    name: 'Integration expense',
    entry_date: '2026-08-15',
    amount: 1,
    details: 'Backfill test',
  });

  await migration.up(db);
  const income = await db('income_entries').where({ id: incomeId }).first();
  const expense = await db('expense_entries').where({ id: expenseId }).first();
  assert.ok(Number(income.bill_no) > 0 && income.income_number);
  assert.ok(Number(expense.bill_no) > 0 && expense.expense_number);
  await assert.rejects(() => db('income_entries').insert({ ...income, id: uuid() }), /duplicate/i);
}

async function runGeneralReportMigrationTests() {
  const commissionMigration =
    await import('../src/db/migrations/20261015120000_general_report_salesman_commission.js');
  const chargeMigration =
    await import('../src/db/migrations/20261015130000_security_charge_classification.js');

  await chargeMigration.down(db);
  await commissionMigration.down(db);
  assert.equal(await db.schema.hasColumn('users_shops', 'commission_basis'), false);
  assert.equal(await db.schema.hasColumn('users_shops', 'commission_rate'), false);
  assert.equal(await db.schema.hasColumn('security_charges', 'condition_kind'), false);
  assert.equal(await db.schema.hasColumn('security_charges', 'funding_source'), false);

  await commissionMigration.up(db);
  await chargeMigration.up(db);
  assert.equal(await db.schema.hasColumn('users_shops', 'commission_basis'), true);
  assert.equal(await db.schema.hasColumn('users_shops', 'commission_rate'), true);
  assert.equal(await db.schema.hasColumn('security_charges', 'condition_kind'), true);
  assert.equal(await db.schema.hasColumn('security_charges', 'funding_source'), true);

  const classifiedCharge = await db('security_charges')
    .where({ shop_id: ids.shop, source: 'return_modal' })
    .whereIn('condition_kind', ['damage', 'missing'])
    .first('condition_kind', 'funding_source');
  assert.ok(classifiedCharge);
  assert.equal(classifiedCharge.funding_source, 'security_retained');
}

async function main() {
  let serviceDb;
  try {
    await db.migrate.latest();
    await db('shops').insert({
      id: ids.shop,
      company_name: 'Integration Test',
      shop_name: 'Integration Test',
    });
    await db('customers').insert({
      id: ids.customer,
      shop_id: ids.shop,
      name: 'Integration Customer',
      phone1: '9999999999',
    });
    await db('payment_accounts').insert({
      shop_id: ids.shop,
      id: ids.paymentAccount,
      name: 'Integration Cash',
      account_group: 'Cash Accounts',
      is_active: true,
    });
    await db('payment_accounts').insert([
      {
        shop_id: ids.shop,
        id: ids.incomeAccount,
        name: 'Integration Income',
        account_group: 'Income',
        is_active: true,
      },
      {
        shop_id: ids.shop,
        id: ids.expenseAccount,
        name: 'Integration Expense',
        account_group: 'Expenses',
        is_active: true,
      },
    ]);
    await db('security_accounts').insert({
      shop_id: ids.shop,
      id: ids.securityAccount,
      name: 'Integration Security',
      is_active: true,
    });

    const serviceModule = await import('../src/modules/orders/service.js');
    const { runOtpIntegrityFixtures } = await import('./otp-integrity-fixtures.js');
    const { runCustomOrderMeasurementMigrationFixtures } =
      await import('./custom-order-measurement-migration-fixtures.js');
    const { runReplacementIntegrityFixtures } = await import('./replacement-integrity-fixtures.js');
    const { runReminderIntegrityFixtures } = await import('./reminder-integrity-fixtures.js');
    const { runConditionLedgerIntegrityFixtures } =
      await import('./condition-ledger-integrity-fixtures.js');
    const { runBookingEditIntegrityFixtures } =
      await import('./booking-edit-integrity-fixtures.js');
    const { runChecklistIntegrityFixtures } = await import('./checklist-integrity-fixtures.js');
    const { runCatalogDeleteIntegrityFixtures } =
      await import('./catalog-delete-integrity-fixtures.js');
    const { runReportAcceptanceFixtures } = await import('./report-acceptance-fixtures.js');
    const { runHttpAcceptanceFixtures } = await import('./http-acceptance-fixtures.js');
    const { runShopEmailIntegrityFixtures } = await import('./shop-email-integrity-fixtures.js');
    const incomeModule = await import('../src/modules/income-entries/service.js');
    const expenseModule = await import('../src/modules/expense-entries/service.js');
    serviceDb = (await import('../src/db/knex.js')).default;
    await runOtpIntegrityFixtures({ db });
    console.info('PASS: persisted OTP lockout and password/session transaction checks');
    await runCustomOrderMeasurementMigrationFixtures({ db });
    console.info('PASS: fresh and populated custom-order migration preservation');
    await runAtomicSettlementTests(serviceModule.settleOrderDelivery);
    console.info('PASS: delivery settlement rollback, replay and stock checks');
    await runAtomicReturnSettlementTests(serviceModule.settleOrderReturn);
    console.info('PASS: return settlement and washing transaction checks');
    await runConditionLedgerIntegrityFixtures({
      db,
      shopId: ids.shop,
      customerId: ids.customer,
      paymentAccountId: ids.paymentAccount,
      securityAccountId: ids.securityAccount,
      incomeAccountId: ids.incomeAccount,
      createProduct,
      createOrder,
    });
    console.info('PASS: condition deposit ledger, refunds, income and report reconciliation');
    await runBookingEditIntegrityFixtures({
      db,
      shopId: ids.shop,
      customerId: ids.customer,
      paymentAccountId: ids.paymentAccount,
      securityAccountId: ids.securityAccount,
      createProduct,
      createOrder,
    });
    console.info(
      'PASS: atomic booking edits, replay, stale balances and partial-refund preservation'
    );
    await runReplacementIntegrityFixtures({ db, shopId: ids.shop, createProduct, createOrder });
    console.info('PASS: future replacement obligations, delivery gates and replay');
    await runReminderIntegrityFixtures({ db, shopId: ids.shop, createOrder });
    console.info('PASS: reminder scheduling and fake-provider dispatch checks');
    await runChecklistIntegrityFixtures({
      db,
      shopId: ids.shop,
      createProduct,
      createOrder,
      createAccessory,
      createOrderAccessory,
      paymentAccountId: ids.paymentAccount,
    });
    console.info(
      'PASS: atomic checklist commands, stale state, replay and quantity-only washing updates'
    );
    await runCatalogDeleteIntegrityFixtures({
      db,
      shopId: ids.shop,
      createOrder,
      createOrderAccessory,
    });
    console.info('PASS: catalog deletion intent, retries, active bookings and washing protection');
    await runReportAcceptanceFixtures({
      db,
      shopId: ids.shop,
      customerId: ids.customer,
      paymentAccountId: ids.paymentAccount,
      securityAccountId: ids.securityAccount,
      incomeAccountId: ids.incomeAccount,
      expenseAccountId: ids.expenseAccount,
      createProduct,
      createOrder,
    });
    console.info('PASS: finance filtering/totals, security status/ranges and salesman commission');
    await runHttpAcceptanceFixtures({
      db,
      shopId: ids.shop,
      paymentAccountId: ids.paymentAccount,
      createProduct,
      createOrder,
    });
    console.info(
      'PASS: authenticated HTTP login, voucher lookup, scoped permissions and checklist commands'
    );
    await runShopEmailIntegrityFixtures({ db });
    console.info(
      'PASS: shop-wise SMTP settings, authorization, secret protection and password OTP routing'
    );
    await runConcurrentDocumentNumberTests(
      incomeModule.createIncomeEntry,
      expenseModule.createExpenseEntry
    );
    await runCorrectiveMigrationTests();
    await runGeneralReportMigrationTests();
    const { runGstIpIntegrityFixtures } = await import('./gst-ip-integrity-fixtures.js');
    await runGstIpIntegrityFixtures({ db });
    console.info('Transaction integrity MySQL checks passed.');
  } finally {
    await db('sync_queue')
      .where({ shop_id: ids.shop })
      .delete()
      .catch(() => {});
    await db('shops')
      .where({ id: ids.shop })
      .delete()
      .catch(() => {});
    await serviceDb?.destroy();
    await db.destroy();
  }
}

await main();
