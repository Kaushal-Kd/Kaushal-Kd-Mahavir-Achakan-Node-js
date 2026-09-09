import assert from 'node:assert/strict';
import { v4 as uuid } from 'uuid';

import {
  createOrUpdateConditionAssessmentWithTrx,
  executeConditionChargeOperation,
  fundConditionChargeWithTrx,
  getOrdinarySecurityHeld,
  summarizeConditionChargeWithTrx,
  assertNoHeldConditionFundsForDeletion,
} from '../src/modules/security-charges/ledgerService.js';
import { getAccountLedgerReport } from '../src/modules/reports/accountLedgerService.js';
import { getDailyCashbookReport } from '../src/modules/reports/dailyCashbookService.js';
import { getIncomeExpenseReport } from '../src/modules/reports/incomeExpenseService.js';
import { getTrialBalanceReport } from '../src/modules/reports/trialBalanceService.js';
import { listSecurityDue } from '../src/modules/payments/securityDueService.js';
import paymentRoutes from '../src/modules/payments/routes.js';
import serviceDb from '../src/db/knex.js';
import { listSecurityTransactions } from '../src/modules/payments/securityTransactionsService.js';
import {
  applyBookingEditPaymentsWithTrx,
  getOrdinarySecurityNet,
} from '../src/modules/payments/bookingEditSettlement.js';

export async function runConditionLedgerIntegrityFixtures({
  db,
  shopId,
  customerId,
  paymentAccountId,
  securityAccountId,
  incomeAccountId,
  createProduct,
  createOrder,
}) {
  const database = String(db.client.config.connection.database || '');
  if (
    process.env.WRS_TEST_MYSQL_INTEGRATION !== '1' ||
    database !== process.env.WRS_TEST_DB_NAME ||
    database !== serviceDb.client.config.connection.database ||
    !/(test|disposable|temporary|tmp)/i.test(database)
  ) {
    throw new Error(
      'Condition money fixtures require the explicitly selected disposable MySQL database'
    );
  }
  const date = '2026-09-05';
  const range = { from: date, to: date };
  const productId = await createProduct(1);
  const { orderId, itemId } = await createOrder({ productId, prepared: true });
  await db('orders').where({ id: orderId, shop_id: shopId }).update({ deposit_amount: 1000 });
  await db('payments').insert({
    id: uuid(),
    shop_id: shopId,
    order_id: orderId,
    customer_id: customerId,
    payment_type: 'cash',
    category: 'deposit',
    amount: 1000,
    payment_date: date,
    security_account_id: securityAccountId,
  });
  const baselineCash = await getAccountLedgerReport(shopId, {
    ...range,
    account_id: paymentAccountId,
  });
  const baselineIncome = await getIncomeExpenseReport(shopId, range);
  const charge = await db.transaction((trx) =>
    createOrUpdateConditionAssessmentWithTrx(trx, {
      shopId,
      userId: null,
      orderId,
      customerId,
      itemType: 'item',
      itemId,
      conditionKind: 'missing',
      amount: 400,
      remarks: 'Missing fixture',
    })
  );
  assert.equal(charge.balances.held, 0);
  assert.equal(await getOrdinarySecurityHeld(db, shopId, orderId), 1000);
  const funded = await db.transaction((trx) =>
    fundConditionChargeWithTrx(trx, {
      shopId,
      userId: null,
      chargeId: charge.id,
      retainAmount: 300,
      collectAmount: 100,
      paymentAccountId,
      paymentDate: date,
      idempotencyKey: uuid(),
    })
  );
  assert.equal(funded.charge.balances.held, 400);
  assert.equal(await getOrdinarySecurityHeld(db, shopId, orderId), 700);
  await assert.rejects(
    () => assertNoHeldConditionFundsForDeletion(db, shopId, orderId),
    /Manage funds/
  );
  const retained = funded.charge.funding_lots.find((lot) => lot.kind === 'retain');
  const collected = funded.charge.funding_lots.find((lot) => lot.kind === 'collect');
  const operation = (kind, amount, fundingId, extra = {}) => ({
    idempotency_key: uuid(),
    kind,
    amount,
    payment_date: date,
    ...(fundingId ? { funding_operation_id: fundingId } : {}),
    ...extra,
  });
  const retainedRefund = operation('refund', 100, retained.id, {
    security_account_id: securityAccountId,
  });
  await executeConditionChargeOperation(shopId, null, charge.id, retainedRefund);
  const replay = await executeConditionChargeOperation(shopId, null, charge.id, retainedRefund);
  assert.equal(replay.replayed, true);
  assert.equal(await getOrdinarySecurityHeld(db, shopId, orderId), 700);
  assert.equal(
    Number(
      (
        await db('security_charge_operations')
          .where({ command_id: retainedRefund.idempotency_key })
          .count('id as n')
          .first()
      ).n
    ),
    1
  );
  await assert.rejects(
    () =>
      executeConditionChargeOperation(shopId, null, charge.id, { ...retainedRefund, amount: 90 }),
    /Idempotency/
  );
  await assert.rejects(
    () =>
      executeConditionChargeOperation(
        uuid(),
        null,
        charge.id,
        operation('collect', 1, null, { payment_account_id: paymentAccountId })
      ),
    /not found/i
  );
  await executeConditionChargeOperation(
    shopId,
    null,
    charge.id,
    operation('settle', 200, retained.id, { income_account_id: incomeAccountId })
  );
  await executeConditionChargeOperation(
    shopId,
    null,
    charge.id,
    operation('refund', 40, collected.id, { payment_account_id: paymentAccountId })
  );
  await executeConditionChargeOperation(
    shopId,
    null,
    charge.id,
    operation('settle', 60, collected.id, { income_account_id: incomeAccountId })
  );
  const final = await summarizeConditionChargeWithTrx(db, shopId, charge.id);
  assert.equal(final.balances.held, 0);
  assert.equal(final.balances.settled, 260);
  await assert.rejects(
    () =>
      executeConditionChargeOperation(
        shopId,
        null,
        charge.id,
        operation('refund', 1, collected.id, { payment_account_id: paymentAccountId })
      ),
    /held funds/
  );
  const cash = await getAccountLedgerReport(shopId, { ...range, account_id: paymentAccountId });
  assert.equal(cash.summary.period_dr_total - baselineCash.summary.period_dr_total, 100);
  assert.equal(cash.summary.period_cr_total - baselineCash.summary.period_cr_total, 40);
  const income = await getIncomeExpenseReport(shopId, range);
  assert.equal(income.summary.income_total - baselineIncome.summary.income_total, 260);
  const trial = await getTrialBalanceReport(shopId, range);
  assert.ok(trial.condition_deposits.supplemental);
  const cashRow = trial.rows.find((row) => row.account_id === paymentAccountId);
  assert.equal(cashRow.curr_dr, cash.summary.period_dr_total);
  assert.equal(cashRow.curr_cr, cash.summary.period_cr_total);
  const cashbook = await getDailyCashbookReport(shopId, { date });
  const dailyCash = cashbook.accounts.find((row) => row.id === paymentAccountId);
  assert.equal(dailyCash.income, cash.summary.period_dr_total);
  assert.equal(dailyCash.expense, cash.summary.period_cr_total);
  const due = await listSecurityDue(shopId, { per_page: 500 });
  assert.equal(Number(due.data.find((row) => row.order_id === orderId).pending_amount), 700);

  const next = await createOrder();
  const concurrentCharge = await db.transaction((trx) =>
    createOrUpdateConditionAssessmentWithTrx(trx, {
      shopId,
      orderId: next.orderId,
      customerId,
      itemType: 'item',
      itemId: next.itemId,
      conditionKind: 'damage',
      amount: 100,
    })
  );
  const direct = await executeConditionChargeOperation(
    shopId,
    null,
    concurrentCharge.id,
    operation('collect', 100, null, { payment_account_id: paymentAccountId })
  );
  const fundingId = direct.charge.funding_lots[0].id;
  // Both requests must reach the blocked order lock before either can spend the lot.
  const blocker = await db.transaction();
  let refundRequests;
  let barrierTimer;
  let onQuery;
  try {
    await blocker('orders').where({ id: next.orderId, shop_id: shopId }).forUpdate().first('id');
    const bothWaiting = new Promise((resolve, reject) => {
      let waiting = 0;
      onQuery = (query) => {
        if (
          query.sql.includes('from `orders`') &&
          query.sql.includes('for update') &&
          query.bindings?.includes(next.orderId)
        ) {
          waiting += 1;
          if (waiting === 2) resolve();
        }
      };
      serviceDb.on('query', onQuery);
      barrierTimer = setTimeout(
        () => reject(new Error('Concurrent refund requests did not both reach the order lock')),
        10_000
      );
    });
    refundRequests = Promise.allSettled(
      [1, 2].map(() =>
        executeConditionChargeOperation(
          shopId,
          null,
          concurrentCharge.id,
          operation('refund', 80, fundingId, { payment_account_id: paymentAccountId })
        )
      )
    );
    await bothWaiting;
    await blocker.commit();
  } catch (error) {
    await blocker.rollback();
    await refundRequests;
    throw error;
  } finally {
    clearTimeout(barrierTimer);
    if (onQuery) serviceDb.removeListener('query', onQuery);
  }
  const refunds = await refundRequests;
  assert.equal(refunds.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(
    (await summarizeConditionChargeWithTrx(db, shopId, concurrentCharge.id)).balances.held,
    20
  );
  await db.transaction((trx) =>
    createOrUpdateConditionAssessmentWithTrx(trx, {
      shopId,
      orderId: next.orderId,
      customerId,
      itemType: 'item',
      itemId: next.itemId,
      conditionKind: null,
      amount: 0,
    })
  );
  const cleared = await summarizeConditionChargeWithTrx(db, shopId, concurrentCharge.id);
  assert.equal(cleared.balances.held, 20);
  assert.equal(cleared.balances.refundable_excess, 20);
  let genericPayment;
  await paymentRoutes({
    addHook() {},
    authenticate() {},
    requireShop() {},
    requireShopAdminPassword() {},
    get() {},
    delete() {},
    post(path, handler) {
      if (path === '/') genericPayment = handler;
    },
  });
  const genericRequest = (category) => ({
    shopId,
    authUser: { id: null },
    audit: async () => {},
    body: {
      order_id: next.orderId,
      customer_id: customerId,
      payment_type: 'cash',
      category,
      amount: 1,
      payment_date: date,
      payment_account_id: paymentAccountId,
    },
  });
  await assert.rejects(() => genericPayment(genericRequest('deposit_refund')), /Manage funds/);
  await assert.rejects(() => genericPayment(genericRequest('deposit')), /Security Amount/);

  const paymentsBeforeEdit = await db('payments')
    .where({ shop_id: shopId, order_id: orderId })
    .count('id as n')
    .first();
  const securityNet = await getOrdinarySecurityNet(db, shopId, orderId);
  assert.equal(securityNet, 900);
  await db.transaction((trx) =>
    applyBookingEditPaymentsWithTrx(trx, shopId, orderId, {
      expected_security_net: securityNet,
      security_net: securityNet,
      payment_date: date,
    })
  );
  await assert.rejects(
    () =>
      db.transaction(async (trx) => {
        await trx('orders').where({ id: orderId }).update({ deposit_amount: 9999 });
        await applyBookingEditPaymentsWithTrx(trx, shopId, orderId, {
          expected_security_net: securityNet,
          security_net: 0,
          security_account_id: securityAccountId,
          payment_date: date,
        });
      }),
    /Manage funds/
  );
  assert.equal(
    Number((await db('orders').where({ id: orderId }).first('deposit_amount')).deposit_amount),
    1000
  );
  assert.equal(
    Number(
      (await db('payments').where({ shop_id: shopId, order_id: orderId }).count('id as n').first())
        .n
    ),
    Number(paymentsBeforeEdit.n)
  );

  const split = await createOrder();
  const secondSecurityId = uuid();
  await db('security_accounts').insert({
    shop_id: shopId,
    id: secondSecurityId,
    name: 'Condition source split test',
    is_active: true,
  });
  await db('orders').where({ id: split.orderId }).update({ deposit_amount: 200 });
  const [earlierReceiptId, laterReceiptId] = [uuid(), uuid()].sort().reverse();
  await db('payments').insert([
    {
      id: earlierReceiptId,
      shop_id: shopId,
      order_id: split.orderId,
      customer_id: customerId,
      payment_type: 'cash',
      category: 'deposit',
      amount: 100,
      payment_date: '2026-09-04',
      created_at: '2026-09-05 00:00:00',
      security_account_id: securityAccountId,
    },
    {
      id: laterReceiptId,
      shop_id: shopId,
      order_id: split.orderId,
      customer_id: customerId,
      payment_type: 'cash',
      category: 'deposit',
      amount: 100,
      payment_date: date,
      created_at: '2026-09-05 00:00:00',
      security_account_id: secondSecurityId,
    },
  ]);
  const splitCharge = await db.transaction((trx) =>
    createOrUpdateConditionAssessmentWithTrx(trx, {
      shopId,
      orderId: split.orderId,
      customerId,
      itemType: 'item',
      itemId: split.itemId,
      conditionKind: 'damage',
      amount: 50,
    })
  );
  const retainedSplit = await executeConditionChargeOperation(
    shopId,
    null,
    splitCharge.id,
    operation('retain', 50)
  );
  assert.equal(
    retainedSplit.charge.funding_lots[0].source_deposit_payment_id,
    earlierReceiptId,
    'Retention must allocate the earliest dated receipt before UUID tie-break ordering'
  );
  assert.equal(retainedSplit.charge.funding_lots[0].security_account_id, securityAccountId);
  const sourceOne = await listSecurityTransactions(shopId, {
    view: 'on_hand',
    security_account_id: securityAccountId,
    to: date,
    per_page: 500,
  });
  const sourceTwo = await listSecurityTransactions(shopId, {
    view: 'on_hand',
    security_account_id: secondSecurityId,
    to: date,
    per_page: 500,
  });
  assert.equal(
    Number(sourceOne.data.find((row) => row.order_id === split.orderId).on_hand_amount),
    50
  );
  assert.equal(
    Number(sourceTwo.data.find((row) => row.order_id === split.orderId).on_hand_amount),
    100
  );
  const period = await listSecurityTransactions(shopId, {
    view: 'receive',
    security_account_id: secondSecurityId,
    from: '2026-09-06',
    to: '2026-09-06',
  });
  assert.equal(period.summary.total_received, 0);
  assert.equal(period.summary.total_charge, 0);
  assert.equal(period.summary.opening_security, 100);
  assert.equal(period.summary.security_on_hand, 100);
  const previousDay = await listSecurityTransactions(shopId, {
    view: 'on_hand',
    security_account_id: securityAccountId,
    to: '2026-09-04',
    per_page: 500,
  });
  assert.equal(
    Number(previousDay.data.find((row) => row.order_id === split.orderId).on_hand_amount),
    100
  );
  const splitFunds = await summarizeConditionChargeWithTrx(db, shopId, splitCharge.id);
  await executeConditionChargeOperation(shopId, null, splitCharge.id, {
    ...operation('release', 50, splitFunds.funding_lots[0].id),
    payment_date: '2026-09-07',
  });
  const nextAssessment = await db.transaction((trx) =>
    createOrUpdateConditionAssessmentWithTrx(trx, {
      shopId,
      orderId: split.orderId,
      customerId,
      itemType: null,
      itemId: null,
      conditionKind: 'missing',
      amount: 20,
    })
  );
  const operationsBeforeBackdate = await db('security_charge_operations')
    .where({ order_id: split.orderId })
    .count('id as n')
    .first();
  await assert.rejects(
    () =>
      executeConditionChargeOperation(shopId, null, nextAssessment.id, {
        ...operation('retain', 20),
        payment_date: '2026-09-06',
      }),
    /cannot precede existing condition-money activity/
  );
  assert.equal(
    Number(
      (
        await db('security_charge_operations')
          .where({ order_id: split.orderId })
          .count('id as n')
          .first()
      ).n
    ),
    Number(operationsBeforeBackdate.n)
  );
  const legacyId = uuid();
  await db('security_charges').insert({
    id: legacyId,
    shop_id: shopId,
    order_id: next.orderId,
    amount: 50,
    status: 'pending',
  });
  await assert.rejects(
    () =>
      executeConditionChargeOperation(
        shopId,
        null,
        legacyId,
        operation('collect', 50, null, { payment_account_id: paymentAccountId })
      ),
    /reconciliation/
  );
  console.info(
    'Condition money lifecycle, reconciliation, replay, concurrency, and shop-scope fixtures passed.'
  );
}
