import { round2 } from '@wrs/shared';

import knex from '../../db/knex.js';
import {
  excludeDirectConditionPayments,
  retainedConditionAllocationExpression,
} from '../security-charges/ledgerPredicates.js';
import { paginate } from '../../utils/pagination.js';

/**
 * Paginated security ledger (deposit + deposit_refund) with order/customer context and KPI summary.
 */
export async function listSecurityTransactions(shopId, query) {
  const q = query || {};

  if (q.view === 'on_hand') {
    return listSecurityOnHand(shopId, q);
  }

  const scopeQb = knex('payments as pm')
    .modify(excludeDirectConditionPayments, 'pm')
    .leftJoin('orders as o', 'o.id', 'pm.order_id')
    .leftJoin('customers as c', 'c.id', 'pm.customer_id')
    .leftJoin('security_accounts as sa', function joinSa() {
      this.on('sa.id', '=', 'pm.security_account_id').andOn('sa.shop_id', '=', 'pm.shop_id');
    })
    .where({ 'pm.shop_id': shopId, 'pm.is_deleted': false, 'o.is_deleted': false })
    .whereIn('pm.category', ['deposit', 'deposit_refund']);

  if (q.security_account_id) {
    scopeQb.andWhere('pm.security_account_id', q.security_account_id);
  }
  if (q.from) scopeQb.andWhere('pm.payment_date', '>=', q.from);
  if (q.to) scopeQb.andWhere('pm.payment_date', '<=', q.to);

  const rowsQb = scopeQb
    .clone()
    .andWhere('pm.category', q.view === 'return' ? 'deposit_refund' : 'deposit')
    .select(
      'pm.id',
      'pm.order_id',
      'pm.payment_date',
      'pm.created_at',
      'pm.amount',
      'pm.category',
      'pm.payment_type',
      'pm.notes',
      'pm.transaction_id',
      'pm.security_account_id',
      'sa.name as security_account_name',
      'o.order_number',
      'o.bill_no',
      'o.status as order_status',
      'o.pickup_name',
      'c.id as customer_id',
      'c.name as customer_name',
      'c.phone1 as customer_phone',
      'c.address as customer_address',
      knex.raw('? AS charge_amount', [
        retainedConditionAllocationExpression(knex, 'pm.order_id', {
          securityAccountId: q.security_account_id,
          from: q.from,
          to: q.to,
        }),
      ])
    );

  const totalsQb = scopeQb
    .clone()
    .clearSelect()
    .clearOrder()
    .select('pm.category', knex.raw('COALESCE(SUM(pm.amount),0) as total'))
    .groupBy('pm.category');

  const [result, totalsRows, allocations, closing, opening] = await Promise.all([
    paginate(rowsQb, {
      page: q.page,
      per_page: q.per_page,
      search: q.search,
      sort: q.sort || '-pm.payment_date',
      search_fields: [
        'o.order_number',
        'c.name',
        'c.phone1',
        'c.address',
        'o.pickup_name',
        'pm.transaction_id',
        'pm.notes',
      ],
    }),
    totalsQb,
    allocationTotal(shopId, { securityAccountId: q.security_account_id, from: q.from, to: q.to }),
    ordinarySecurityBalance(shopId, { securityAccountId: q.security_account_id, to: q.to }),
    q.from
      ? ordinarySecurityBalance(shopId, {
          securityAccountId: q.security_account_id,
          before: q.from,
        })
      : 0,
  ]);

  const received = Number(totalsRows.find((r) => r.category === 'deposit')?.total || 0);
  const returned = Number(totalsRows.find((r) => r.category === 'deposit_refund')?.total || 0);

  const summary = {
    total_received: round2(received),
    total_returned: round2(returned),
    total_charge: round2(allocations),
    opening_security: round2(opening),
    security_on_hand: round2(closing),
  };

  return { ...result, summary };
}

async function allocationTotal(shopId, filters) {
  const row = await knex('orders')
    .where({ shop_id: shopId, is_deleted: false })
    .select(
      knex.raw('COALESCE(SUM(?),0) as total', [
        retainedConditionAllocationExpression(knex, 'orders.id', filters),
      ])
    )
    .first();
  return Number(row?.total || 0);
}

async function ordinarySecurityBalance(shopId, filters) {
  const payments = knex('payments as pm')
    .modify(excludeDirectConditionPayments, 'pm')
    .join('orders as o', 'o.id', 'pm.order_id')
    .where({ 'pm.shop_id': shopId, 'pm.is_deleted': false, 'o.is_deleted': false })
    .whereIn('pm.category', ['deposit', 'deposit_refund']);
  if (filters.securityAccountId)
    payments.where('pm.security_account_id', filters.securityAccountId);
  if (filters.to) payments.where('pm.payment_date', '<=', filters.to);
  if (filters.before) payments.where('pm.payment_date', '<', filters.before);
  const [row, allocated] = await Promise.all([
    payments
      .select(
        knex.raw(
          "COALESCE(SUM(CASE WHEN pm.category = 'deposit' THEN pm.amount ELSE -pm.amount END),0) as total"
        )
      )
      .first(),
    allocationTotal(shopId, filters),
  ]);
  return round2(Number(row?.total || 0) - allocated);
}

async function listSecurityOnHand(shopId, query) {
  const paymentAgg = knex('payments')
    .modify(excludeDirectConditionPayments)
    .where({ shop_id: shopId, is_deleted: false })
    .whereIn('category', ['deposit', 'deposit_refund'])
    .whereNotNull('order_id')
    .groupBy('order_id')
    .select(
      'order_id',
      knex.raw(
        "COALESCE(SUM(CASE WHEN category = 'deposit' THEN amount ELSE 0 END), 0) as received_amount"
      ),
      knex.raw(
        "COALESCE(SUM(CASE WHEN category = 'deposit_refund' THEN amount ELSE 0 END), 0) as return_amount"
      ),
      knex.raw('MAX(payment_date) as last_payment_date')
    );
  if (query.security_account_id) {
    paymentAgg.andWhere('security_account_id', query.security_account_id);
  }
  if (query.to) paymentAgg.andWhere('payment_date', '<=', query.to);
  const retainedAgg = knex('orders')
    .where({ shop_id: shopId })
    .select(
      'id as order_id',
      knex.raw('? as retained_amount', [
        retainedConditionAllocationExpression(knex, 'orders.id', {
          securityAccountId: query.security_account_id,
          to: query.to,
        }),
      ])
    );

  const baseQb = knex
    .from(paymentAgg.as('p'))
    .innerJoin('orders as o', 'o.id', 'p.order_id')
    .leftJoin(retainedAgg.as('r'), 'r.order_id', 'p.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false })
    .whereRaw('(p.received_amount - p.return_amount - COALESCE(r.retained_amount, 0)) > 0');

  if (query.from)
    baseQb.andWhere(function recentActivity() {
      this.where('p.last_payment_date', '>=', query.from).orWhereExists(
        function recentAllocation() {
          this.select(1)
            .from('security_charge_operations as activity')
            .whereRaw('activity.order_id = o.id AND activity.shop_id = o.shop_id')
            .where('activity.payment_date', '>=', query.from);
          if (query.to) this.where('activity.payment_date', '<=', query.to);
          if (query.security_account_id)
            this.where('activity.security_account_id', query.security_account_id);
        }
      );
    });
  if (query.to) baseQb.andWhere('p.last_payment_date', '<=', query.to);

  const rowsQb = baseQb
    .clone()
    .select(
      'o.id as id',
      'o.id as order_id',
      'o.order_number',
      'o.bill_no',
      'o.status as order_status',
      'o.pickup_name',
      'c.id as customer_id',
      'c.name as customer_name',
      'c.phone1 as customer_phone',
      'c.address as customer_address',
      'p.last_payment_date as payment_date',
      'p.received_amount',
      'p.return_amount',
      knex.raw('COALESCE(r.retained_amount, 0) as charge_amount'),
      knex.raw(
        '(p.received_amount - p.return_amount - COALESCE(r.retained_amount, 0)) as on_hand_amount'
      )
    );

  const requestedSort = String(query.sort || '-p.last_payment_date')
    .replaceAll('pm.created_at', 'p.last_payment_date')
    .replaceAll('pm.amount', 'on_hand_amount');
  const result = await paginate(rowsQb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: requestedSort,
    search_fields: ['o.order_number', 'c.name', 'c.phone1', 'c.address', 'o.pickup_name'],
  });
  const summaryRow = await baseQb
    .clone()
    .clearSelect()
    .clearOrder()
    .select(
      knex.raw('COALESCE(SUM(p.received_amount), 0) as received'),
      knex.raw('COALESCE(SUM(p.return_amount), 0) as returned'),
      knex.raw('COALESCE(SUM(COALESCE(r.retained_amount, 0)), 0) as charge'),
      knex.raw(
        'COALESCE(SUM(p.received_amount - p.return_amount - COALESCE(r.retained_amount, 0)), 0) as on_hand'
      )
    )
    .first();
  return {
    ...result,
    summary: {
      total_received: round2(Number(summaryRow?.received || 0)),
      total_returned: round2(Number(summaryRow?.returned || 0)),
      total_charge: round2(Number(summaryRow?.charge || 0)),
      security_on_hand: round2(Number(summaryRow?.on_hand || 0)),
    },
  };
}
