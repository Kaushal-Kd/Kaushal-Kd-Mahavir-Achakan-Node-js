import { normalizeSqlDateToIso, round2 } from '@wrs/shared';

import knex from '../../db/knex.js';

const EXCLUDED_ORDER_STATUSES = ['draft', 'cancelled'];

function monthRange(month) {
  const [y, m] = String(month).split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to, month: String(month) };
}

function emptySummary() {
  return {
    bill_count: 0,
    product_count: 0,
    product_amount: 0,
    accessory_count: 0,
    accessory_amount: 0,
    bill_discount: 0,
    item_discount: 0,
    total_amount: 0,
    commission_amount: 0,
  };
}

function sumRows(rows) {
  const summary = emptySummary();
  for (const r of rows) {
    summary.bill_count += Number(r.bill_count || 0);
    summary.product_count += Number(r.product_count || 0);
    summary.product_amount = round2(summary.product_amount + Number(r.product_amount || 0));
    summary.accessory_count += Number(r.accessory_count || 0);
    summary.accessory_amount = round2(summary.accessory_amount + Number(r.accessory_amount || 0));
    summary.bill_discount = round2(summary.bill_discount + Number(r.bill_discount || 0));
    summary.item_discount = round2(summary.item_discount + Number(r.item_discount || 0));
    summary.total_amount = round2(summary.total_amount + Number(r.total_amount || 0));
    summary.commission_amount = round2(
      summary.commission_amount + Number(r.commission_amount || 0)
    );
  }
  return summary;
}

export function compareSalesmanReportRows(a, b) {
  const dateCmp = String(a.bill_date || '').localeCompare(String(b.bill_date || ''));
  if (dateCmp !== 0) return dateCmp;
  return String(a.salesman_name || '').localeCompare(String(b.salesman_name || ''));
}

function sortRows(rows) {
  return rows.sort(compareSalesmanReportRows);
}

export function calculateSalesmanCommission(basis, rate, bookingCount, productQty) {
  const fixedRate = Math.max(0, Number(rate || 0));
  if (basis === 'booking') return round2(fixedRate * Math.max(0, Number(bookingCount || 0)));
  if (basis === 'product') return round2(fixedRate * Math.max(0, Number(productQty || 0)));
  return 0;
}

export function allocateSalesmanBillDiscount(discount, selectedGross, orderGross) {
  return round2(Number(orderGross) > 0 ? Number(discount || 0) * Number(selectedGross || 0) / Number(orderGross) : 0);
}

function resolveRange(query) {
  if (query.month) return monthRange(query.month);
  return { from: query.from, to: query.to, month: null };
}

const COMMISSION_EARNED_STATUSES = new Set([
  'delivered',
  'partially_returned',
  'returned',
  'closed',
]);

async function getBookingSalesmanReport(shopId, range, query) {
  const qb = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('products as p', 'p.id', 'oi.product_id')
    .leftJoin('users as u', function joinSalesPerson() {
      this.on('u.id', '=', knex.raw('COALESCE(oi.sales_person_id, o.sales_person_id)'));
    })
    .where('oi.shop_id', shopId)
    .andWhere('o.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .whereNotIn('o.status', EXCLUDED_ORDER_STATUSES)
    .whereBetween('o.booking_date', [range.from, range.to])
    .whereNotNull('oi.product_id')
    .select(
      'o.id as order_id',
      'o.booking_date as bill_date',
      'o.status as order_status',
      'o.sales_person_id as booking_sales_person_id',
      knex.raw('COALESCE(oi.sales_person_id, o.sales_person_id) as sales_person_id'),
      knex.raw("COALESCE(NULLIF(TRIM(u.name), ''), u.email, 'Unassigned') as salesman_name"),
      'o.booking_discount_amount',
      knex.raw(`(SELECT COALESCE(SUM(full_line.price * full_line.qty), 0)
        FROM order_items full_line WHERE full_line.order_id = o.id AND full_line.shop_id = o.shop_id
          AND full_line.product_id IS NOT NULL) as allocation_order_gross`),
      'oi.id as line_id',
      'oi.price',
      'oi.qty',
      'oi.discount'
    );

  if (query.sales_person_id) {
    if (query.sales_person_id === 'none') {
      qb.andWhereRaw('COALESCE(oi.sales_person_id, o.sales_person_id) IS NULL');
    } else {
      qb.andWhereRaw('COALESCE(oi.sales_person_id, o.sales_person_id) = ?', [
        query.sales_person_id,
      ]);
    }
  }
  if (query.category_id === 'none') {
    qb.whereNull('p.category_id');
  } else if (query.category_id) {
    qb.andWhere('p.category_id', query.category_id);
  }

  const lines = await qb;

  const byGroup = new Map();
  const orderMeta = new Map();

  for (const line of lines) {
    const orderId = line.order_id;
    const salesPersonId = line.sales_person_id || null;
    const billDate = normalizeSqlDateToIso(line.bill_date);
    const gross = round2(Number(line.price || 0) * Number(line.qty || 1));
    const itemDisc = round2(Number(line.discount || 0) * Number(line.qty || 1));

    if (!orderMeta.has(orderId)) {
      orderMeta.set(orderId, {
        bill_date: billDate,
        booking_discount_amount: Number(line.booking_discount_amount || 0),
        bySalesPerson: new Map(),
        orderGross: Number(line.allocation_order_gross || 0),
        order_status: line.order_status,
        booking_sales_person_id: line.booking_sales_person_id || null,
      });
    }
    const om = orderMeta.get(orderId);
    const spKey = salesPersonId || '__none__';
    if (!om.bySalesPerson.has(spKey)) {
      om.bySalesPerson.set(spKey, {
        sales_person_id: salesPersonId,
        gross: 0,
        item_discount: 0,
        product_qty: 0,
        order_ids: new Set(),
      });
    }
    const sp = om.bySalesPerson.get(spKey);
    sp.gross = round2(sp.gross + gross);
    sp.item_discount = round2(sp.item_discount + itemDisc);
    sp.product_qty += Number(line.qty || 0);
    sp.order_ids.add(orderId);
  }

  for (const [, om] of orderMeta) {
    const orderDisc = round2(Number(om.booking_discount_amount || 0));
    for (const [, sp] of om.bySalesPerson) {
      const allocatedBillDisc = allocateSalesmanBillDiscount(orderDisc, sp.gross, om.orderGross);
      const groupKey = `${sp.sales_person_id || ''}|${om.bill_date}`;
      if (!byGroup.has(groupKey)) {
        byGroup.set(groupKey, {
          sales_person_id: sp.sales_person_id,
          salesman_name: '',
          bill_date: om.bill_date,
          order_ids: new Set(),
          product_count: 0,
          product_amount: 0,
          accessory_count: 0,
          accessory_amount: 0,
          item_discount: 0,
          bill_discount: 0,
          commission_product_qty: 0,
          commission_booking_order_ids: new Set(),
        });
      }
      const g = byGroup.get(groupKey);
      for (const oid of sp.order_ids) g.order_ids.add(oid);
      g.product_count += sp.product_qty;
      g.product_amount = round2(g.product_amount + sp.gross);
      g.item_discount = round2(g.item_discount + sp.item_discount);
      g.bill_discount = round2(g.bill_discount + allocatedBillDisc);
      if (COMMISSION_EARNED_STATUSES.has(String(om.order_status || '').toLowerCase())) {
        g.commission_product_qty += sp.product_qty;
      }
    }
  }

  for (const line of lines) {
    const salesPersonId = line.sales_person_id || null;
    const billDate = normalizeSqlDateToIso(line.bill_date);
    const groupKey = `${salesPersonId || ''}|${billDate}`;
    const g = byGroup.get(groupKey);
    if (g && !g.salesman_name) {
      g.salesman_name = String(line.salesman_name || 'Unassigned').trim() || 'Unassigned';
    }
  }

  if (!query.category_id) {
    const accessories = await knex('order_accessories as oa')
      .join('orders as o', 'o.id', 'oa.order_id')
      .leftJoin('order_items as linked_oi', 'linked_oi.id', 'oa.order_item_id')
      .leftJoin('users as u', function joinAccessorySalesPerson() {
        this.on(
          'u.id',
          '=',
          knex.raw(
            'CASE WHEN oa.order_item_id IS NULL THEN o.sales_person_id ELSE COALESCE(linked_oi.sales_person_id, o.sales_person_id) END'
          )
        );
      })
      .where('oa.shop_id', shopId)
      .andWhere('o.shop_id', shopId)
      .andWhere('o.is_deleted', false)
      .whereNotIn('o.status', EXCLUDED_ORDER_STATUSES)
      .whereBetween('o.booking_date', [range.from, range.to])
      .modify((qb) => {
        if (query.sales_person_id) {
          if (query.sales_person_id === 'none') {
            qb.andWhereRaw(
              'CASE WHEN oa.order_item_id IS NULL THEN o.sales_person_id ELSE COALESCE(linked_oi.sales_person_id, o.sales_person_id) END IS NULL'
            );
          } else {
            qb.andWhereRaw(
              'CASE WHEN oa.order_item_id IS NULL THEN o.sales_person_id ELSE COALESCE(linked_oi.sales_person_id, o.sales_person_id) END = ?',
              [query.sales_person_id]
            );
          }
        }
      })
      .select(
        'o.id as order_id',
        'o.booking_date as bill_date',
        'oa.qty',
        'oa.price',
        'oa.discount',
        knex.raw(
          'CASE WHEN oa.order_item_id IS NULL THEN o.sales_person_id ELSE COALESCE(linked_oi.sales_person_id, o.sales_person_id) END as sales_person_id'
        ),
        knex.raw("COALESCE(NULLIF(TRIM(u.name), ''), u.email, 'Unassigned') as salesman_name")
      );

    for (const accessory of accessories) {
      const billDate = normalizeSqlDateToIso(accessory.bill_date);
      const salesPersonId = accessory.sales_person_id || null;
      const groupKey = `${salesPersonId || ''}|${billDate}`;
      if (!byGroup.has(groupKey)) {
        byGroup.set(groupKey, {
          sales_person_id: salesPersonId,
          salesman_name: String(accessory.salesman_name || 'Unassigned').trim() || 'Unassigned',
          bill_date: billDate,
          order_ids: new Set(),
          product_count: 0,
          product_amount: 0,
          accessory_count: 0,
          accessory_amount: 0,
          item_discount: 0,
          bill_discount: 0,
          commission_product_qty: 0,
          commission_booking_order_ids: new Set(),
        });
      }
      const group = byGroup.get(groupKey);
      group.order_ids.add(accessory.order_id);
      const qty = Number(accessory.qty || 0);
      group.accessory_count += qty;
      group.accessory_amount = round2(
        group.accessory_amount +
          Math.max(0, Number(accessory.price || 0) - Number(accessory.discount || 0)) * qty
      );
    }
  }

  const eligibleBookings = await knex('orders as o')
    .leftJoin('users as u', 'u.id', 'o.sales_person_id')
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false })
    .whereIn('o.status', [...COMMISSION_EARNED_STATUSES])
    .whereBetween('o.booking_date', [range.from, range.to])
    .modify((qb) => {
      if (query.sales_person_id === 'none') qb.whereNull('o.sales_person_id');
      else if (query.sales_person_id) qb.andWhere('o.sales_person_id', query.sales_person_id);
      if (query.category_id) qb.whereExists(function matchingCategory() {
        this.select(1).from('order_items as category_line')
          .join('products as category_product', function joinProduct() {
            this.on('category_product.id', 'category_line.product_id').andOn('category_product.shop_id', 'category_line.shop_id');
          })
          .whereRaw('category_line.order_id = o.id AND category_line.shop_id = o.shop_id');
        if (query.category_id === 'none') this.whereNull('category_product.category_id');
        else this.where('category_product.category_id', query.category_id);
      });
    })
    .select(
      'o.id',
      'o.booking_date',
      'o.sales_person_id',
      knex.raw("COALESCE(NULLIF(TRIM(u.name), ''), u.email, 'Unassigned') as salesman_name")
    );

  for (const order of eligibleBookings) {
    const billDate = normalizeSqlDateToIso(order.booking_date);
    const salesPersonId = order.sales_person_id || null;
    const groupKey = `${salesPersonId || ''}|${billDate}`;
    if (!byGroup.has(groupKey)) {
      byGroup.set(groupKey, {
        sales_person_id: salesPersonId,
        salesman_name: String(order.salesman_name || 'Unassigned').trim() || 'Unassigned',
        bill_date: billDate,
        order_ids: new Set(),
        product_count: 0,
        product_amount: 0,
        accessory_count: 0,
        accessory_amount: 0,
        item_discount: 0,
        bill_discount: 0,
        commission_product_qty: 0,
        commission_booking_order_ids: new Set(),
      });
    }
    const group = byGroup.get(groupKey);
    group.order_ids.add(order.id);
    if (salesPersonId) group.commission_booking_order_ids.add(order.id);
  }

  const salesmanIds = [
    ...new Set([...byGroup.values()].map((g) => g.sales_person_id).filter(Boolean)),
  ];
  const commissionRows = salesmanIds.length
    ? await knex('users_shops')
        .where({ shop_id: shopId })
        .whereIn('user_id', salesmanIds)
        .select('user_id', 'commission_basis', 'commission_rate')
    : [];
  const commissionBySalesman = new Map(commissionRows.map((row) => [row.user_id, row]));

  const rows = [...byGroup.values()].map((g) => {
    const commission = commissionBySalesman.get(g.sales_person_id);
    const rate = Number(commission?.commission_rate || 0);
    const commissionAmount = calculateSalesmanCommission(
      commission?.commission_basis,
      rate,
      g.commission_booking_order_ids.size,
      g.commission_product_qty
    );
    return {
      sales_person_id: g.sales_person_id,
      salesman_name: g.salesman_name || 'Unassigned',
      bill_date: g.bill_date,
      bill_count: g.order_ids.size,
      product_count: g.product_count,
      product_amount: g.product_amount,
      accessory_count: g.accessory_count,
      accessory_amount: g.accessory_amount,
      bill_discount: g.bill_discount,
      item_discount: g.item_discount,
      total_amount: round2(
        g.product_amount + g.accessory_amount - g.item_discount - g.bill_discount
      ),
      commission_basis: commission?.commission_basis || null,
      commission_rate: round2(rate),
      commission_amount: round2(commissionAmount),
    };
  });

  return { rows: sortRows(rows), summary: sumRows(rows) };
}

async function getSaleSalesmanReport(shopId, range, query) {
  const perSale = knex('sale_items as si')
    .join('sales as s', 's.id', 'si.sale_id')
    .where('s.shop_id', shopId)
    .andWhere('si.shop_id', shopId)
    .whereNot('s.status', 'cancelled')
    .whereBetween('s.sale_date', [range.from, range.to])
    .groupBy('s.id', 's.sales_person_id', 's.sale_date', 's.discount_amount', 's.total_amount')
    .select(
      's.id as sale_id',
      's.sales_person_id',
      's.sale_date as bill_date',
      's.discount_amount',
      's.total_amount',
      knex.raw('COALESCE(SUM(si.qty), 0) as product_count'),
      knex.raw('COALESCE(SUM(si.price * si.qty), 0) as product_amount'),
      knex.raw('COALESCE(SUM(si.discount * si.qty), 0) as item_discount')
    );

  if (query.sales_person_id === 'none') {
    perSale.whereNull('s.sales_person_id');
  } else if (query.sales_person_id) {
    perSale.andWhere('s.sales_person_id', query.sales_person_id);
  }

  const saleRows = await perSale;

  const nameRows = await knex('users as u')
    .join('users_shops as us', 'us.user_id', 'u.id')
    .where('us.shop_id', shopId)
    .select('u.id', 'u.name', 'u.email');
  const nameById = new Map(
    nameRows.map((u) => [u.id, String(u.name || u.email || 'Unassigned').trim() || 'Unassigned'])
  );

  const byGroup = new Map();
  for (const r of saleRows) {
    const billDate = normalizeSqlDateToIso(r.bill_date);
    const salesPersonId = r.sales_person_id || null;
    const key = `${salesPersonId || ''}|${billDate}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        sales_person_id: salesPersonId,
        salesman_name: salesPersonId ? nameById.get(salesPersonId) || 'Unassigned' : 'Unassigned',
        bill_date: billDate,
        bill_count: 0,
        product_count: 0,
        product_amount: 0,
        accessory_count: 0,
        accessory_amount: 0,
        bill_discount: 0,
        item_discount: 0,
        total_amount: 0,
        commission_amount: 0,
      });
    }
    const g = byGroup.get(key);
    g.bill_count += 1;
    g.product_count += Number(r.product_count || 0);
    g.product_amount = round2(g.product_amount + Number(r.product_amount || 0));
    g.item_discount = round2(g.item_discount + Number(r.item_discount || 0));
    g.bill_discount = round2(g.bill_discount + Number(r.discount_amount || 0));
    g.total_amount = round2(g.total_amount + Number(r.total_amount || 0));
  }

  const rows = [...byGroup.values()];
  return { rows: sortRows(rows), summary: sumRows(rows) };
}

/**
 * @param {string} shopId
 * @param {{ month?: string; from?: string; to?: string; type?: string; sales_person_id?: string; category_id?: string }} query
 */
export async function getSalesmanReport(shopId, query) {
  const range = resolveRange(query);
  const type = query.type === 'sale' ? 'sale' : 'booking';

  const { rows, summary } =
    type === 'sale'
      ? await getSaleSalesmanReport(shopId, range, query)
      : await getBookingSalesmanReport(shopId, range, query);

  return {
    range,
    type,
    rows,
    summary,
  };
}
