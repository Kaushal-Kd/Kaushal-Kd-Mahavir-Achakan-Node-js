import { round2 } from '@wrs/shared';

import knex from '../../db/knex.js';
import { paginate } from '../../utils/pagination.js';
import { excludeDirectConditionPayments } from '../security-charges/ledgerPredicates.js';
import { securityChargeAmountSql } from '../security-charges/service.js';

const CHARGE_AMOUNT_SQL = securityChargeAmountSql('o.id');
const PENDING_AMOUNT_SQL = `(d.collected_amount - d.return_amount - ${CHARGE_AMOUNT_SQL})`;

export function deriveReturnStatus(row) {
  const total = Number(row.rent_line_count || 0);
  const received = Number(row.received_line_count || 0);
  const delivered = Number(row.delivered_line_count || 0);
  if (row.order_status === 'cancelled') return 'cancelled';
  if (total > 0 && received >= total) return 'returned';
  if (received > 0) return 'partially_returned';
  if (delivered > 0 || ['delivered', 'partially_returned'].includes(String(row.order_status))) {
    return 'delivered';
  }
  if (total > 0 && ['returned', 'closed'].includes(String(row.order_status))) return 'booked';
  return String(row.order_status || 'booked');
}

/**
 * One row per order with collected / returned security and damage charge (pending computed on client or inline).
 */
export async function listSecurityDue(shopId, query) {
  const q = query || {};

  const dueAgg = knex('payments')
    .modify(excludeDirectConditionPayments)
    .where({ shop_id: shopId, is_deleted: false })
    .whereIn('category', ['deposit', 'deposit_refund'])
    .whereNotNull('order_id')
    .groupBy('order_id')
    .havingRaw("COALESCE(SUM(CASE WHEN category = 'deposit' THEN amount ELSE 0 END), 0) > 0")
    .select(
      'order_id',
      knex.raw(
        "COALESCE(SUM(CASE WHEN category = 'deposit' THEN amount ELSE 0 END), 0) as collected_amount"
      ),
      knex.raw(
        "COALESCE(SUM(CASE WHEN category = 'deposit_refund' THEN amount ELSE 0 END), 0) as return_amount"
      ),
      knex.raw('MAX(payment_date) as last_payment_date')
    );

  const baseQb = knex
    .from(dueAgg.as('d'))
    .innerJoin('orders as o', 'o.id', 'd.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false });

  if (q.from) baseQb.andWhere('d.last_payment_date', '>=', q.from);
  if (q.to) baseQb.andWhere('d.last_payment_date', '<=', q.to);
  if (q.amount_filter === 'collected') baseQb.andWhere('d.collected_amount', '>', 0);
  if (q.amount_filter === 'return') baseQb.andWhere('d.return_amount', '>', 0);
  if (q.amount_filter === 'charge') baseQb.andWhereRaw(`${CHARGE_AMOUNT_SQL} > 0`);
  if (q.amount_filter === 'pending') baseQb.andWhereRaw(`${PENDING_AMOUNT_SQL} > 0`);
  const searchFields = ['o.order_number', 'c.name', 'c.phone1', 'c.address', 'o.pickup_name'];
  if (String(q.search || '').trim()) baseQb.andWhere((qb) => {
    for (const field of searchFields) qb.orWhere(field, 'like', `%${String(q.search).trim()}%`);
  });

  const rowsQb = baseQb.clone().select(
    'o.id as order_id',
    'o.order_number',
    'o.bill_no',
    'o.status as order_status',
    'o.pickup_name',
    'c.id as customer_id',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.address as customer_address',
    'd.collected_amount',
    'd.return_amount',
    'd.last_payment_date',
    knex.raw(`${CHARGE_AMOUNT_SQL} AS charge_amount`),
    knex.raw(`${PENDING_AMOUNT_SQL} AS pending_amount`),
    knex.raw(`(
      SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi
      WHERE oi.order_id = o.id AND LOWER(COALESCE(oi.type, 'rent')) <> 'sell'
    ) + (
      SELECT COALESCE(SUM(oa.qty),0) FROM order_accessories oa
      WHERE oa.order_id = o.id AND LOWER(COALESCE(oa.type, 'rent')) <> 'sell'
    ) AS rent_line_count`),
    knex.raw(`(
      SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi
      WHERE oi.order_id = o.id AND LOWER(COALESCE(oi.type, 'rent')) <> 'sell'
        AND COALESCE(oi.missing, 0) = 0
        AND JSON_UNQUOTE(JSON_EXTRACT(oi.stage_flags, '$.received')) IN ('true', '1')
    ) + (
      SELECT COALESCE(SUM(GREATEST(0, oa.qty - CASE WHEN COALESCE(oa.missing,0) <> 0
        THEN COALESCE(NULLIF(oa.missing_qty,0),oa.qty) ELSE 0 END)),0) FROM order_accessories oa
      WHERE oa.order_id = o.id AND LOWER(COALESCE(oa.type, 'rent')) <> 'sell'
        AND JSON_UNQUOTE(JSON_EXTRACT(oa.stage_flags, '$.received')) IN ('true', '1')
    ) AS received_line_count`),
    knex.raw(`(
      SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi
      WHERE oi.order_id = o.id AND LOWER(COALESCE(oi.type, 'rent')) <> 'sell'
        AND JSON_UNQUOTE(JSON_EXTRACT(oi.stage_flags, '$.delivered')) IN ('true', '1')
    ) + (
      SELECT COALESCE(SUM(oa.qty),0) FROM order_accessories oa
      WHERE oa.order_id = o.id AND LOWER(COALESCE(oa.type, 'rent')) <> 'sell'
        AND JSON_UNQUOTE(JSON_EXTRACT(oa.stage_flags, '$.delivered')) IN ('true', '1')
    ) AS delivered_line_count`)
  );

  const sumsQb = baseQb
    .clone()
    .clearSelect()
    .clearOrder()
    .select(
      knex.raw('COALESCE(SUM(d.collected_amount), 0) as total_collected'),
      knex.raw('COALESCE(SUM(d.return_amount), 0) as total_return')
    );

  const orderIdsQb = baseQb
    .clone()
    .clearSelect()
    .clearOrder()
    .select('o.id as order_id')
    .groupBy('o.id');

  const [result, sumsRow, orderIdRows] = await Promise.all([
    paginate(rowsQb, {
      page: q.page,
      per_page: q.per_page,
      sort: q.sort || '-d.last_payment_date',
    }),
    sumsQb.first(),
    orderIdsQb,
  ]);

  const orderIds = orderIdRows.map((r) => r.order_id).filter(Boolean);
  let totalCharge = 0;
  if (orderIds.length > 0) {
    const chargeRow = await knex('orders').where({ shop_id: shopId }).whereIn('id', orderIds)
      .select(knex.raw(`COALESCE(SUM(${securityChargeAmountSql('orders.id')}),0) as t`)).first();
    totalCharge = Number(chargeRow?.t || 0);
  }

  const totalCollected = Number(sumsRow?.total_collected || 0);
  const totalReturn = Number(sumsRow?.total_return || 0);

  result.data = result.data.map((row) => ({
    ...row,
    derived_status: deriveReturnStatus(row),
    pending_amount: round2(Number(row.pending_amount || 0)),
  }));

  const summary = {
    total_collected: round2(totalCollected),
    total_return: round2(totalReturn),
    total_charge: round2(totalCharge),
    total_pending: round2(totalCollected - totalReturn - totalCharge),
  };

  return { ...result, summary };
}
