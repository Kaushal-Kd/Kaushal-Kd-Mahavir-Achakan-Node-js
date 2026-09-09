import { round2 } from '@wrs/shared';

import knex from '../../db/knex.js';

const RETURN_PENDING_STATUSES = ['partially_returned', 'returned', 'closed'];

function advancePaymentsForShop(shopId) {
  return knex('payments as p')
    .where({
      'p.shop_id': shopId,
      'p.is_deleted': false,
      'p.category': 'advance',
    })
    .whereNotNull('p.order_id')
    .groupBy('p.order_id')
    .select('p.order_id')
    .sum({ advance_amount: 'p.amount' });
}

export function mapPendingBillRow(row) {
  return {
    id: row.id,
    order_number: row.order_number,
    bill_no: Number(row.bill_no ?? 0),
    pickup_name: row.pickup_name,
    pickup_number: row.pickup_number,
    total_amount: round2(Number(row.total_amount ?? 0)),
    advance_amount: round2(Number(row.advance_amount ?? 0)),
    balance: round2(Number(row.balance ?? 0)),
    status: row.status,
    return_date: row.return_date,
    reference_name: row.reference_name,
    address: row.address || '',
  };
}

/**
 * @param {string} shopId
 * @param {{ page: number; per_page: number; search?: string; from?: string; to?: string }} query
 */
export async function listPendingBills(shopId, query) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.per_page) || 20));

  const base = knex('orders as o')
    .leftJoin('customers as c', function joinCustomer() {
      this.on('c.id', '=', 'o.customer_id').andOn('c.shop_id', '=', 'o.shop_id');
    })
    .leftJoin(advancePaymentsForShop(shopId).as('adv'), 'adv.order_id', 'o.id')
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false })
    .where('o.balance', '>', 0)
    .whereIn('o.status', RETURN_PENDING_STATUSES);

  if (query.from && query.to) {
    base.whereBetween('o.return_date', [query.from, query.to]);
  } else if (query.from) {
    base.andWhere('o.return_date', '>=', query.from);
  } else if (query.to) {
    base.andWhere('o.return_date', '<=', query.to);
  }

  const search = String(query.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    base.andWhere((b) =>
      b.where('o.order_number', 'like', like)
        .orWhere('o.pickup_name', 'like', like)
        .orWhere('o.pickup_number', 'like', like)
        .orWhere('c.address', 'like', like)
        .orWhere('o.contact_address', 'like', like)
    );
  }

  const [agg] = await base
    .clone()
    .clearSelect()
    .clearOrder()
    .select(
      knex.raw('COUNT(*) as cnt'),
      knex.raw('COALESCE(SUM(o.total_amount), 0) as total_bill'),
      knex.raw('COALESCE(SUM(adv.advance_amount), 0) as total_advance'),
      knex.raw('COALESCE(SUM(o.balance), 0) as total_pending')
    );

  const total = Number(agg?.cnt || 0);
  const summary = {
    total_bill_amount: round2(Number(agg?.total_bill ?? 0)),
    total_advance_amount: round2(Number(agg?.total_advance ?? 0)),
    total_pending_amount: round2(Number(agg?.total_pending ?? 0)),
    count: total,
  };

  const sortDir = query.sort_dir === 'asc' ? 'asc' : 'desc';
  const sortColumn = query.sort_by === 'bill_no' ? 'o.bill_no' : 'o.return_date';
  const rows = await base
    .clone()
    .select(
      'o.id',
      'o.order_number',
      'o.bill_no',
      'o.pickup_name',
      'o.pickup_number',
      'o.total_amount',
      knex.raw('COALESCE(adv.advance_amount, 0) as advance_amount'),
      'o.balance',
      'o.status',
      'o.return_date',
      'o.reference_name',
      knex.raw(
        "COALESCE(NULLIF(TRIM(c.address), ''), NULLIF(TRIM(o.contact_address), ''), ?) as address",
        ['']
      )
    )
    .orderBy(sortColumn, sortDir)
    .orderBy('o.return_date', sortDir)
    .orderBy('o.id', 'asc')
    .offset((page - 1) * perPage)
    .limit(perPage);

  const mapped = rows.map(mapPendingBillRow);

  return {
    rows: mapped,
    summary,
    meta: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.ceil(total / perPage) || 0,
    },
  };
}
