import { normalizeSqlDateToIso, round2 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { insertOrderPayment } from '../payments/orderStatusAtPayment.js';
import { createIncomeEntryForSecuritySettle } from '../income-entries/service.js';
import {
  buildConditionDepositReconciliation,
  conditionOperationDateError,
  fundingLotBalances,
  summarizeChargeOperations,
} from './ledgerMath.js';
import {
  excludeDirectConditionPayments,
  retainedConditionAllocationSql,
} from './ledgerPredicates.js';

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0)
    throw badRequest('Amount must be a nonnegative number');
  return round2(amount);
}

function decode(value) {
  if (typeof value === 'object' && value !== null) return value;
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}

async function account(db, shopId, paymentId, securityId) {
  if (Boolean(paymentId) === Boolean(securityId))
    throw badRequest('Choose one bank/cash or security account');
  const table = paymentId ? 'payment_accounts' : 'security_accounts';
  const row = await db(table)
    .where({ shop_id: shopId, id: paymentId || securityId, is_active: true })
    .first();
  if (!row) throw badRequest('Unknown or inactive account');
  if (
    paymentId &&
    !['cash accounts', 'bank accounts'].includes(
      String(row.account_group || '')
        .trim()
        .toLowerCase()
    )
  ) {
    throw badRequest('Choose a bank or cash account');
  }
}

export async function summarizeConditionChargeWithTrx(db, shopId, chargeId) {
  const charge = await db('security_charges').where({ id: chargeId, shop_id: shopId }).first();
  if (!charge) throw notFound('Condition charge not found');
  const operations = await db('security_charge_operations')
    .where({ shop_id: shopId, charge_id: chargeId })
    .orderBy('created_at')
    .orderBy('operation_index');
  return {
    ...charge,
    amount: Number(charge.amount),
    ledger_verified: Number(charge.money_flow_version) === 1,
    balances: summarizeChargeOperations(charge.amount, operations),
    funding_lots: fundingLotBalances(operations),
    operations,
  };
}

async function lockCharge(db, shopId, chargeId) {
  const initial = await db('security_charges')
    .where({ id: chargeId, shop_id: shopId })
    .first('order_id');
  if (!initial) throw notFound('Condition charge not found');
  const order = await db('orders')
    .where({ id: initial.order_id, shop_id: shopId, is_deleted: false })
    .forUpdate()
    .first();
  if (!order) throw notFound('Order not found');
  const charge = await db('security_charges')
    .where({ id: chargeId, shop_id: shopId })
    .forUpdate()
    .first();
  if (Number(charge.money_flow_version) !== 1)
    throw badRequest(
      'Legacy charge needs reconciliation before money can be collected, refunded, or settled'
    );
  if (charge.status === 'void') throw badRequest('This charge is void');
  return { order, charge };
}

async function appendOperation(db, row) {
  const max = await db('security_charge_operations')
    .where({ shop_id: row.shop_id, command_id: row.command_id })
    .max('operation_index as n')
    .first();
  const operation = { id: uuid(), operation_index: Number(max?.n ?? -1) + 1, ...row };
  await db('security_charge_operations').insert(operation);
  return operation;
}

async function assertConditionOperationDate(db, shopId, orderId, paymentDate) {
  // A release on another charge must not fund an allocation backdated before that release.
  const row = await db('security_charge_operations')
    .where({ shop_id: shopId, order_id: orderId })
    .max('payment_date as latest')
    .first();
  const error = conditionOperationDateError(paymentDate, row?.latest);
  if (error) throw badRequest(error);
}

async function refreshCharge(db, shopId, chargeId) {
  const summary = await summarizeConditionChargeWithTrx(db, shopId, chargeId);
  const { held, uncollected, settled } = summary.balances;
  if (held < -0.009) throw conflict('Condition funds have changed; refresh before continuing');
  await db('security_charges')
    .where({ id: chargeId, shop_id: shopId })
    .update({
      status: held <= 0 && uncollected <= 0 && settled > 0 ? 'settled' : 'pending',
      updated_at: db.fn.now(),
    });
  return summarizeConditionChargeWithTrx(db, shopId, chargeId);
}

export async function createOrUpdateConditionAssessmentWithTrx(db, options) {
  const { shopId, userId, orderId, customerId, itemType, itemId, conditionKind, remarks } = options;
  const amount = money(options.amount);
  const matches = await db('security_charges')
    .where({ shop_id: shopId, order_id: orderId, item_type: itemType, item_id: itemId })
    .whereNot('status', 'void')
    .forUpdate();
  const unresolvedLegacy = matches.find(
    (row) => Number(row.money_flow_version) !== 1 && Number(row.amount) > 0
  );
  if (unresolvedLegacy)
    return {
      ...(await summarizeConditionChargeWithTrx(db, shopId, unresolvedLegacy.id)),
      skipped_legacy: true,
    };
  const existing = matches.find((row) => Number(row.money_flow_version) === 1);
  if (existing) {
    await db('security_charges')
      .where({ id: existing.id, shop_id: shopId })
      .update({
        amount,
        condition_kind: conditionKind || null,
        remarks: remarks || null,
        updated_at: db.fn.now(),
      });
    return refreshCharge(db, shopId, existing.id);
  }
  const id = uuid();
  await db('security_charges').insert({
    id,
    shop_id: shopId,
    order_id: orderId,
    customer_id: customerId || null,
    item_type: itemType,
    item_id: itemId,
    amount,
    condition_kind: conditionKind || null,
    remarks: remarks || null,
    status: 'pending',
    source: 'return_modal',
    money_flow_version: 1,
    created_by: userId || null,
  });
  return summarizeConditionChargeWithTrx(db, shopId, id);
}

async function availableDepositLots(db, shopId, orderId) {
  const deposits = await excludeDirectConditionPayments(
    db('payments').where({
      shop_id: shopId,
      order_id: orderId,
      is_deleted: false,
      category: 'deposit',
    })
  )
    .orderBy('payment_date')
    .orderBy('created_at')
    .orderBy('id')
    .forUpdate();
  const refunds = await excludeDirectConditionPayments(
    db('payments').where({
      shop_id: shopId,
      order_id: orderId,
      is_deleted: false,
      category: 'deposit_refund',
    })
  )
    .sum('amount as n')
    .first();
  const operations = await db('security_charge_operations').where({
    shop_id: shopId,
    order_id: orderId,
  });
  const legacy = await db('security_charges')
    .where({ shop_id: shopId, order_id: orderId })
    .whereNull('money_flow_version')
    .whereNot('status', 'void')
    .where((q) =>
      q
        .where('funding_source', 'security_retained')
        .orWhere((old) => old.whereNull('funding_source').where('source', 'return_modal'))
    )
    .sum('amount as n')
    .first();
  const byId = new Map(operations.map((row) => [row.id, row]));
  const allocated = new Map();
  let retainedRefunds = 0;
  for (const row of operations) {
    const lot = row.kind === 'retain' ? row : byId.get(row.funding_operation_id);
    if (lot?.kind !== 'retain') continue;
    const delta =
      row.kind === 'retain' ? Number(row.amount) : row.kind === 'release' ? -Number(row.amount) : 0;
    allocated.set(
      lot.source_deposit_payment_id,
      (allocated.get(lot.source_deposit_payment_id) || 0) + delta
    );
    if (row.kind === 'refund') retainedRefunds += Number(row.amount);
  }
  // Refunds linked to retained lots already consume their original receipt allocation.
  let unallocatedConsumption =
    Math.max(0, Number(refunds?.n || 0) - retainedRefunds) + Number(legacy?.n || 0);
  return deposits
    .map((deposit) => {
      const remaining = Math.max(0, Number(deposit.amount) - (allocated.get(deposit.id) || 0));
      const used = Math.min(remaining, unallocatedConsumption);
      unallocatedConsumption -= used;
      return { ...deposit, available: round2(remaining - used) };
    })
    .filter((row) => row.available > 0);
}

export async function fundConditionChargeWithTrx(db, options) {
  const { shopId, userId, chargeId, paymentAccountId, paymentDate } = options;
  const commandId = options.idempotencyKey || uuid();
  const retainAmount = money(options.retainAmount || 0);
  const collectAmount = money(options.collectAmount || 0);
  if (!retainAmount && !collectAmount)
    return { charge: await summarizeConditionChargeWithTrx(db, shopId, chargeId), operations: [] };
  const { order, charge } = await lockCharge(db, shopId, chargeId);
  await assertConditionOperationDate(db, shopId, order.id, paymentDate);
  const current = await summarizeConditionChargeWithTrx(db, shopId, chargeId);
  if (retainAmount + collectAmount > current.balances.uncollected + 0.009)
    throw badRequest('Funding cannot exceed the uncollected assessed charge');
  if ((retainAmount || collectAmount) && !order.customer_id)
    throw badRequest('Add a customer before collecting condition money');
  const base = {
    shop_id: shopId,
    charge_id: chargeId,
    order_id: order.id,
    command_id: commandId,
    payment_date: paymentDate,
    created_by: userId || null,
    remarks: options.remarks || charge.remarks || null,
  };
  const operations = [];
  if (retainAmount > 0) {
    const lots = (await availableDepositLots(db, shopId, order.id)).filter(
      (lot) => normalizeSqlDateToIso(lot.payment_date) <= paymentDate
    );
    if (lots.reduce((sum, row) => sum + row.available, 0) + 0.009 < retainAmount)
      throw badRequest('Retain amount exceeds available booking security');
    let remaining = retainAmount;
    for (const lot of lots) {
      const amount = round2(Math.min(lot.available, remaining));
      if (amount <= 0) continue;
      if (!lot.payment_account_id && !lot.security_account_id)
        throw badRequest('Original security receipt has no verified source account');
      operations.push(
        await appendOperation(db, {
          ...base,
          kind: 'retain',
          amount,
          source_deposit_payment_id: lot.id,
          payment_account_id: lot.payment_account_id || null,
          security_account_id: lot.payment_account_id ? null : lot.security_account_id,
        })
      );
      remaining = round2(remaining - amount);
    }
  }
  if (collectAmount > 0) {
    await account(db, shopId, paymentAccountId, null);
    const paymentId = uuid();
    await insertOrderPayment(
      db,
      shopId,
      {
        id: paymentId,
        shop_id: shopId,
        order_id: order.id,
        customer_id: order.customer_id,
        received_by: userId || null,
        payment_type: 'cash',
        category: 'deposit',
        amount: collectAmount,
        payment_date: paymentDate,
        payment_stage: 'return',
        payment_account_id: paymentAccountId,
        security_account_id: null,
        notes: `Condition deposit: ${chargeId}`,
      },
      'return'
    );
    operations.push(
      await appendOperation(db, {
        ...base,
        kind: 'collect',
        amount: collectAmount,
        payment_id: paymentId,
        payment_account_id: paymentAccountId,
        security_account_id: null,
      })
    );
  }
  return { charge: await refreshCharge(db, shopId, chargeId), operations };
}

export async function applyConditionChargeOperationWithTrx(db, shopId, userId, chargeId, body) {
  const { order, charge } = await lockCharge(db, shopId, chargeId);
  const amount = money(body.amount);
  if (amount <= 0) throw badRequest('Amount must be positive');
  if (['collect', 'retain'].includes(body.kind)) {
    return fundConditionChargeWithTrx(db, {
      shopId,
      userId,
      chargeId,
      collectAmount: body.kind === 'collect' ? amount : 0,
      retainAmount: body.kind === 'retain' ? amount : 0,
      paymentAccountId: body.payment_account_id,
      paymentDate: body.payment_date,
      idempotencyKey: body.idempotency_key,
      remarks: body.remarks,
    });
  }
  await assertConditionOperationDate(db, shopId, order.id, body.payment_date);
  const current = await summarizeConditionChargeWithTrx(db, shopId, chargeId);
  const lot = current.funding_lots.find((row) => row.id === body.funding_operation_id);
  if (!lot) throw badRequest('Select the original held funding lot');
  if (body.payment_date < normalizeSqlDateToIso(lot.payment_date))
    throw badRequest('Operation date cannot precede the original funding date');
  if (amount > lot.available + 0.009) throw badRequest('Amount exceeds the remaining held funds');
  if (body.kind === 'release' && lot.kind !== 'retain')
    throw badRequest('Only retained booking security can be released');
  if (
    body.kind === 'settle' &&
    amount > Math.max(0, Number(charge.amount) - current.balances.settled) + 0.009
  ) {
    throw badRequest('Income settlement cannot exceed the remaining assessment');
  }
  const row = {
    shop_id: shopId,
    charge_id: chargeId,
    order_id: order.id,
    command_id: body.idempotency_key,
    kind: body.kind,
    amount,
    funding_operation_id: lot.id,
    source_deposit_payment_id: lot.source_deposit_payment_id || null,
    payment_date: body.payment_date,
    created_by: userId || null,
    remarks: body.remarks || null,
    payment_account_id: lot.payment_account_id || null,
    security_account_id: lot.security_account_id || null,
  };
  if (body.kind === 'refund') {
    await account(db, shopId, body.payment_account_id, body.security_account_id);
    if (!order.customer_id) throw badRequest('Add a customer before refunding money');
    row.payment_id = uuid();
    await insertOrderPayment(
      db,
      shopId,
      {
        id: row.payment_id,
        shop_id: shopId,
        order_id: order.id,
        customer_id: order.customer_id,
        received_by: userId || null,
        payment_type: 'cash',
        category: 'deposit_refund',
        amount,
        payment_date: body.payment_date,
        payment_stage: 'return',
        payment_account_id: body.payment_account_id || null,
        security_account_id: body.security_account_id || null,
        notes: `Condition deposit refund: ${chargeId}`,
      },
      'return'
    );
  } else if (body.kind === 'settle') {
    const income = await createIncomeEntryForSecuritySettle(
      shopId,
      userId,
      {
        income_account_id: body.income_account_id,
        payment_account_id: lot.payment_account_id || null,
        security_account_id: lot.security_account_id || null,
        name: order.pickup_name || 'Condition deposit settlement',
        entry_date: body.payment_date,
        amount,
        details: `Bill ${order.order_number} · Condition deposit income · ${charge.remarks || ''}`,
      },
      db
    );
    row.income_entry_id = income.id;
  } else if (body.kind !== 'release') throw badRequest('Unknown condition money operation');
  const operation = await appendOperation(db, row);
  return { charge: await refreshCharge(db, shopId, chargeId), operations: [operation] };
}

export async function executeConditionChargeOperation(shopId, userId, chargeId, body) {
  const fingerprint = JSON.stringify(canonical(body));
  return knex
    .transaction(
      async (db) => {
        await lockCharge(db, shopId, chargeId);
        const previous = await db('sync_queue')
          .where({ id: body.idempotency_key })
          .forUpdate()
          .first();
        if (previous) {
          const saved = decode(previous.payload);
          if (
            previous.shop_id !== shopId ||
            previous.entity !== 'security_charge_operation' ||
            previous.entity_id !== chargeId ||
            saved.fingerprint !== fingerprint
          ) {
            throw conflict('Idempotency key was used for a different operation');
          }
          return { ...saved.result, replayed: true };
        }
        await db('sync_queue').insert({
          id: body.idempotency_key,
          shop_id: shopId,
          user_id: userId || null,
          entity: 'security_charge_operation',
          entity_id: chargeId,
          op: 'update',
          status: 'processing',
        });
        const result = await applyConditionChargeOperationWithTrx(
          db,
          shopId,
          userId,
          chargeId,
          body
        );
        await db('sync_queue')
          .where({ id: body.idempotency_key })
          .update({
            status: 'synced',
            synced_at: db.fn.now(),
            payload: JSON.stringify({ fingerprint, result }),
          });
        return result;
      },
      { isolationLevel: 'read committed' }
    )
    .catch((error) => {
      if (error?.code === 'ER_DUP_ENTRY')
        throw conflict(
          'Idempotency key was already used; refresh before submitting a different operation'
        );
      throw error;
    });
}

export async function enrichChargeLedgerRows(db, shopId, rows) {
  if (!rows.length) return rows;
  const operations = await db('security_charge_operations')
    .where({ shop_id: shopId })
    .whereIn(
      'charge_id',
      rows.map((row) => row.id)
    );
  return rows.map((row) => ({
    ...row,
    ledger_verified: Number(row.money_flow_version) === 1,
    balances: summarizeChargeOperations(
      row.amount,
      operations.filter((op) => op.charge_id === row.id)
    ),
  }));
}

export async function getConditionDepositReconciliation(shopId, { from, to }, db = knex) {
  const operations = await db('security_charge_operations as co')
    .leftJoin('payment_accounts as pa', function joinPayment() {
      this.on('pa.id', 'co.payment_account_id').andOn('pa.shop_id', 'co.shop_id');
    })
    .leftJoin('security_accounts as sa', function joinSecurity() {
      this.on('sa.id', 'co.security_account_id').andOn('sa.shop_id', 'co.shop_id');
    })
    .where('co.shop_id', shopId)
    .where('co.payment_date', '<=', to)
    .select('co.*', db.raw('COALESCE(pa.name, sa.name) as account_name'));
  const normalized = operations.map((row) => ({
    ...row,
    payment_date: normalizeSqlDateToIso(row.payment_date),
  }));
  return buildConditionDepositReconciliation(normalized, from, to);
}

export async function getOrdinarySecurityHeld(db, shopId, orderId) {
  const payments = await excludeDirectConditionPayments(
    db('payments').where({ shop_id: shopId, order_id: orderId, is_deleted: false })
  )
    .whereIn('category', ['deposit', 'deposit_refund'])
    .select(
      db.raw(
        "COALESCE(SUM(CASE WHEN category = 'deposit' THEN amount ELSE -amount END), 0) as held"
      )
    )
    .first();
  const order = await db('orders')
    .where({ shop_id: shopId, id: orderId })
    .select(db.raw(`${retainedConditionAllocationSql('orders.id')} as retained`))
    .first();
  return round2(Math.max(0, Number(payments?.held || 0) - Number(order?.retained || 0)));
}

export async function assertNoHeldConditionFundsForDeletion(db, shopId, orderId) {
  const [held, legacy] = await Promise.all([
    db('security_charge_operations')
      .where({ shop_id: shopId, order_id: orderId })
      .select(
        db.raw(
          "COALESCE(SUM(CASE WHEN kind IN ('collect','retain') THEN amount ELSE -amount END),0) as held"
        )
      )
      .first(),
    db('security_charges')
      .where({ shop_id: shopId, order_id: orderId, status: 'pending' })
      .whereNull('money_flow_version')
      .where('amount', '>', 0)
      .first('id'),
  ]);
  if (Number(held?.held || 0) > 0 || legacy) {
    throw badRequest(
      'Resolve held condition funds in Manage funds and reconcile legacy charges before deleting this booking'
    );
  }
}
