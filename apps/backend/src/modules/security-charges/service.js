import { round2 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import {
  enrichSecurityChargeRows,
  formatChecklistChargeRemarks,
  resolveChargeItemLabel,
} from './chargeItemLabels.js';
import { createOrUpdateConditionAssessmentWithTrx, enrichChargeLedgerRows, executeConditionChargeOperation } from './ledgerService.js';
import { retainedConditionAllocationSql } from './ledgerPredicates.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

const PENDING_CHARGE_SUBQUERY = `(
  COALESCE((
    SELECT SUM(sc.amount)
    FROM security_charges AS sc
    WHERE sc.order_id = ORD_ID_REF AND sc.status = 'pending'
  ), 0)
)`;

export function pendingChargeAmountSql(orderIdRef) {
  return PENDING_CHARGE_SUBQUERY.replace(/ORD_ID_REF/g, orderIdRef);
}

export function securityChargeAmountSql(orderIdRef) {
  return retainedConditionAllocationSql(orderIdRef);
}

function normalizeAccountGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const SETTLE_ACCOUNT_GROUPS = new Set(['bank accounts', 'cash accounts']);

export function buildSecurityChargesListQuery(shopId, db = knex) {
  return db('security_charges as sc')
    .where({ 'sc.shop_id': shopId })
    .innerJoin('orders as o', function joinO() {
      this.on('o.id', '=', 'sc.order_id').andOn('o.shop_id', '=', 'sc.shop_id');
    })
    .leftJoin('customers as c', 'c.id', 'sc.customer_id')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'sc.shop_id').andOn('pa.id', '=', 'sc.payment_account_id');
    })
    .leftJoin('security_accounts as sa', function joinSa() {
      this.on('sa.shop_id', '=', 'sc.shop_id').andOn('sa.id', '=', 'sc.security_account_id');
    })
    .select(
      'sc.id',
      'sc.shop_id',
      'sc.order_id',
      'sc.customer_id',
      'sc.amount',
      'sc.money_flow_version',
      'sc.remarks',
      'sc.status',
      'sc.source',
      'sc.condition_kind',
      'sc.funding_source',
      'sc.item_type',
      'sc.item_id',
      'sc.payment_account_id',
      'sc.security_account_id',
      'sc.income_entry_id',
      'sc.settled_at',
      'sc.created_by',
      'sc.created_at',
      'sc.updated_at',
      'o.order_number',
      'o.bill_no',
      'o.pickup_name',
      'c.name as customer_name',
      'c.phone1 as customer_phone',
      'c.address as customer_address',
      db.raw('pa.name as payment_account_name'),
      db.raw('sa.name as security_account_name')
    );
}

export async function getPendingChargesTotalForOrder(shopId, orderId, trxOrKnex = knex) {
  const row = await trxOrKnex('security_charges')
    .where({ shop_id: shopId, order_id: orderId, status: 'pending' })
    .select(trxOrKnex.raw('COALESCE(SUM(amount),0) as total'))
    .first();
  return round2(Number(row?.total || 0));
}

export async function listSecurityCharges(shopId, query) {
  const q = query || {};
  const qb = buildSecurityChargesListQuery(shopId);

  if (q.order_id) qb.andWhere('sc.order_id', q.order_id);
  if (q.condition_kind) qb.andWhere('sc.condition_kind', q.condition_kind);
  if (q.collection_status === 'legacy') qb.whereNull('sc.money_flow_version');
  const heldSql = `(SELECT COALESCE(SUM(CASE WHEN co.kind IN ('collect','retain') THEN co.amount ELSE -co.amount END),0)
    FROM security_charge_operations co WHERE co.charge_id = sc.id AND co.shop_id = sc.shop_id)`;
  const settledSql = `(SELECT COALESCE(SUM(co.amount),0) FROM security_charge_operations co
    WHERE co.charge_id = sc.id AND co.shop_id = sc.shop_id AND co.kind = 'settle')`;
  if (q.collection_status === 'held') qb.where('sc.money_flow_version', 1).whereRaw(`${heldSql} > 0`);
  if (q.collection_status === 'uncollected') qb.where('sc.money_flow_version', 1)
    .where((filter) => filter.whereRaw(`sc.amount - ${heldSql} - ${settledSql} > 0`)
      .orWhere((missing) => missing.where('sc.condition_kind', 'missing').where('sc.amount', 0)));
  if (q.settled === true) qb.andWhere('sc.status', 'settled');
  else if (q.settled === false) qb.andWhere('sc.status', 'pending');

  const result = await paginate(qb, {
    page: q.page,
    per_page: q.per_page,
    search: q.search,
    sort: q.sort || '-sc.created_at',
    search_fields: [
      'o.order_number',
      'c.name',
      'c.phone1',
      'c.address',
      'o.pickup_name',
      'sc.remarks',
    ],
  });

  result.data = await enrichSecurityChargeRows(knex, shopId, result.data);
  result.data = await enrichChargeLedgerRows(knex, shopId, result.data);

  const summaryQb = knex('security_charges as sc')
    .where({ 'sc.shop_id': shopId })
    .select(
      knex.raw(
        "COALESCE(SUM(CASE WHEN sc.status = 'pending' THEN sc.amount ELSE 0 END), 0) as total_pending"
      ),
      knex.raw(
        "COALESCE(SUM(CASE WHEN sc.status = 'settled' THEN sc.amount ELSE 0 END), 0) as total_settled"
      )
    )
    .first();

  if (q.order_id) summaryQb.andWhere('sc.order_id', q.order_id);

  const summaryRow = await summaryQb;
  const movementSummary = knex('security_charge_operations').where({ shop_id: shopId });
  if (q.order_id) movementSummary.where('order_id', q.order_id);
  const movement = await movementSummary.select(
    knex.raw("COALESCE(SUM(CASE WHEN kind IN ('collect','retain') THEN amount ELSE -amount END),0) as held"),
    knex.raw("COALESCE(SUM(CASE WHEN kind = 'settle' THEN amount ELSE 0 END),0) as recognized")
  ).first();

  return {
    ...result,
    summary: {
      total_pending: round2(Number(summaryRow?.total_pending || 0)),
      total_settled: round2(Number(summaryRow?.total_settled || 0)),
      total_held: round2(Number(movement?.held || 0)),
      total_recognized: round2(Number(movement?.recognized || 0)),
    },
  };
}

export function formatListRow(row) {
  if (!row) return row;
  return {
    ...row,
    amount: round2(Number(row.amount || 0)),
  };
}

export async function syncReturnSettlementChargeWithTrx() {
  throw badRequest('Use explicit assessed, retain, collect, or refund amounts. Remaining security is not automatically a condition charge.');
}

export async function syncReturnSettlementCharge(shopId, authUserId, body) {
  return knex.transaction((trx) =>
    syncReturnSettlementChargeWithTrx(trx, shopId, authUserId, body)
  );
}

export async function createSecurityCharge(shopId, authUserId, body) {
  const order = await knex('orders')
    .where({ id: body.order_id, shop_id: shopId, is_deleted: false })
    .select('id', 'customer_id', 'order_number', 'bill_no')
    .first();
  if (!order) throw notFound('Order not found');

  const amount = round2(Number(body.amount));
  if (amount <= 0) throw badRequest('Charge amount must be positive');

  const id = uuid();
  const remarks = body.remarks != null ? String(body.remarks).trim() : '';
  await knex('security_charges').insert({
    id,
    shop_id: shopId,
    order_id: order.id,
    customer_id: order.customer_id || null,
    amount,
    remarks: remarks || null,
    status: 'pending',
    money_flow_version: 1,
    source: body.source || 'return_modal',
    item_type: null,
    item_id: null,
    created_by: authUserId || null,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  let row = await buildSecurityChargesListQuery(shopId).where('sc.id', id).first();
  [row] = await enrichSecurityChargeRows(knex, shopId, row ? [row] : []);
  return formatListRow(row);
}

/**
 * Sync pending security charge from checklist damage_charge on a line.
 * @param {import('knex').Knex.Transaction} trx
 */
export async function syncChecklistSecurityCharge(
  trx,
  { shopId, orderId, customerId, itemType, itemId, amount, conditionKind, userId }
) {
  const itemLabel = await resolveChargeItemLabel(trx, shopId, itemType, itemId);
  const remarks = formatChecklistChargeRemarks(null, itemType, itemLabel, conditionKind);
  return createOrUpdateConditionAssessmentWithTrx(trx, {
    shopId, userId, orderId, customerId, itemType, itemId, amount,
    conditionKind, remarks,
  });
}

/**
 * One order-level pending charge for combined missing/damage entry (voids per-line checklist charges).
 * @param {import('knex').Knex|import('knex').Knex.Transaction} trxOrKnex
 */
export async function syncCombinedChecklistSecurityCharge(
  trxOrKnex,
  { shopId, orderId, customerId, amount, remarks, paymentAccountId, userId }
) {
  if (!trxOrKnex.isTransaction) return trxOrKnex.transaction((trx) => syncCombinedChecklistSecurityCharge(trx, {
    shopId, orderId, customerId, amount, remarks, paymentAccountId, userId,
  }));
  const trx = trxOrKnex;
  await trx('orders').where({ id: orderId, shop_id: shopId }).forUpdate().first('id');
  const linkedMoney = await trx('security_charge_operations').where({ shop_id: shopId, order_id: orderId }).first('id');
  if (linkedMoney) throw badRequest('Funded condition assessments cannot be merged; manage the individual item funds');
  const legacy = await trx('security_charges').where({ shop_id: shopId, order_id: orderId }).whereNull('money_flow_version')
    .whereNot('status', 'void').where('amount', '>', 0).first('id');
  if (legacy) throw badRequest('Legacy charges need reconciliation before changing combined assessments');
  const chargeAmount = round2(Math.max(0, Number(amount || 0)));
  const remarkTrim = String(remarks || '').trim();
  if (chargeAmount <= 0 && !remarkTrim) {
    throw badRequest('Remarks are required when charge amount is zero');
  }

  await trx('security_charges')
    .where({ shop_id: shopId, order_id: orderId, source: 'checklist', status: 'pending' })
    .update({
      status: 'void',
      amount: 0,
      payment_account_id: null,
      security_account_id: null,
      updated_at: trx.fn.now(),
    });

  let notePaymentAccountId = null;
  if (chargeAmount > 0 && paymentAccountId) {
    const acc = String(paymentAccountId).trim().slice(0, 80);
    const pa = await trx('payment_accounts')
      .where({ shop_id: shopId, id: acc, is_active: true })
      .first();
    if (pa && SETTLE_ACCOUNT_GROUPS.has(normalizeAccountGroup(pa.account_group))) {
      notePaymentAccountId = acc;
    }
  }

  const remarkText = remarkTrim || 'Damage/missing · Combined charge';
  const id = uuid();
  await trx('security_charges').insert({
    id,
    shop_id: shopId,
    order_id: orderId,
    customer_id: customerId || null,
    amount: chargeAmount,
    remarks: remarkText.slice(0, 2000),
    status: 'pending',
    source: 'checklist',
    money_flow_version: 1,
    item_type: null,
    item_id: null,
    payment_account_id: notePaymentAccountId,
    security_account_id: null,
    created_by: userId || null,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });

  return { id, amount: chargeAmount, remarks: remarkText };
}

export async function settleSecurityCharge(shopId, authUserId, chargeId, body) {
  if (!body.idempotency_key || !body.funding_operation_id || !body.amount || !body.payment_date) {
    throw badRequest('Use Manage funds to explicitly choose held funds and a settlement amount');
  }
  const result = await executeConditionChargeOperation(shopId, authUserId, chargeId, { ...body, kind: 'settle' });
  return result.charge;
}
