import { SYSTEM_LOG_MODULES, systemLogActionLabel, toLocalISODate, toIndiaYearMonth, DELIVERY_PENDING_ORDER_STATUSES } from '@wrs/shared';

import knex from '../../db/knex.js';
import { countItemsToCollect, countItemsToPrepare } from '../orders/service.js';
import { listLowStockAccessories } from '../accessories/service.js';
import { loadDashboardDaySettings, lookaheadRange, lookbackRange } from './dashboardSettings.js';

export default async function dashboardRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const shopId = request.shopId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = toLocalISODate(today);

    const daySettings = await loadDashboardDaySettings(shopId);
    const pendingDeliveryRange = lookbackRange(today, daySettings.pendingDeliveryDays);
    const pendingReturnRange = lookbackRange(today, daySettings.pendingReturnDays);
    const itemToCollectRange = lookaheadRange(today, daySettings.itemToCollectDays);
    const itemToPrepareRange = lookaheadRange(today, daySettings.itemToPrepareDays);

    const RETURN_PENDING_STATUSES = ['delivered', 'partially_returned'];
    /** Handover done: out for rent / closed — counts toward “completed” for today’s pickup list. */
    const DELIVERY_DONE_SQL =
      "SUM(CASE WHEN status IN ('delivered', 'partially_returned', 'returned', 'closed') THEN 1 ELSE 0 END) as completed_c";
    const RETURN_DONE_SQL =
      "SUM(CASE WHEN status IN ('partially_returned', 'returned', 'closed') THEN 1 ELSE 0 END) as completed_c";

    const [
      bookingsToday,
      deliveriesTodayAgg,
      returnsToday,
      revenueToday,
      pendingDelivery,
      pendingReturn,
      itemToCollectCount,
      itemToPrepareCount,
      dueAgg,
      depositAgg,
      lowStockAccessories,
    ] =
      await Promise.all([
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .andWhere('booking_date', todayISO)
          .count({ c: '*' })
          .first(),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .andWhere('pickup_date', todayISO)
          .select(knex.raw('COUNT(*) as c'), knex.raw(DELIVERY_DONE_SQL))
          .first(),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .andWhere('return_date', todayISO)
          .select(knex.raw('COUNT(*) as c'), knex.raw(RETURN_DONE_SQL))
          .first(),
        knex('payments')
          .where({ shop_id: shopId, is_deleted: false })
          .andWhere('payment_date', todayISO)
          .whereIn('category', ['advance', 'partial', 'final'])
          .sum({ total: 'amount' })
          .first(),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .whereIn('status', DELIVERY_PENDING_ORDER_STATUSES)
          .whereBetween('pickup_date', [pendingDeliveryRange.from, pendingDeliveryRange.to])
          .count({ c: '*' })
          .first(),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .whereIn('status', RETURN_PENDING_STATUSES)
          .whereBetween('return_date', [pendingReturnRange.from, pendingReturnRange.to])
          .count({ c: '*' })
          .first(),
        countItemsToCollect(shopId, {
          pickup_from: itemToCollectRange.from,
          pickup_to: itemToCollectRange.to,
        }),
        countItemsToPrepare(shopId, {
          pickup_from: itemToPrepareRange.from,
          pickup_to: itemToPrepareRange.to,
        }),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .whereIn('payment_status', ['pending', 'partial'])
          .sum({ balance: 'balance' })
          .first(),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false, deposit_received: true, deposit_returned: false })
          .sum({ held: 'deposit_amount' })
          .first(),
        listLowStockAccessories(shopId, 40),
      ]);

    const pendingDeliveryPayload = {
      from: pendingDeliveryRange.from,
      to: pendingDeliveryRange.to,
      count: num(pendingDelivery?.c),
      days: pendingDeliveryRange.days,
    };
    const pendingReturnPayload = {
      from: pendingReturnRange.from,
      to: pendingReturnRange.to,
      count: num(pendingReturn?.c),
      days: pendingReturnRange.days,
    };
    const itemToCollectPayload = {
      from: itemToCollectRange.from,
      to: itemToCollectRange.to,
      count: num(itemToCollectCount),
      days: itemToCollectRange.days,
    };
    const itemToPreparePayload = {
      from: itemToPrepareRange.from,
      to: itemToPrepareRange.to,
      count: num(itemToPrepareCount),
      days: itemToPrepareRange.days,
    };

    return {
      ok: true,
      data: {
        today: {
          bookings: num(bookingsToday?.c),
          deliveries: num(deliveriesTodayAgg?.c),
          deliveries_completed: num(deliveriesTodayAgg?.completed_c),
          returns: num(returnsToday?.c),
          returns_completed: num(returnsToday?.completed_c),
          revenue: num(revenueToday?.total),
        },
        pending_dues: num(dueAgg?.balance),
        security_held: num(depositAgg?.held),
        pending_delivery: pendingDeliveryPayload,
        pending_return: pendingReturnPayload,
        item_to_collect: itemToCollectPayload,
        item_to_prepare: itemToPreparePayload,
        /** @deprecated use pending_delivery */
        pending_delivery_9d: pendingDeliveryPayload,
        /** @deprecated use pending_return */
        pending_return_12d: pendingReturnPayload,
        low_stock_accessories: lowStockAccessories || [],
      },
    };
  });

  /** Calendar events — aggregates bookings, pickups, returns for a given month (or custom range). */
  fastify.get('/calendar', async (request) => {
    const shopId = request.shopId;
    const { from, to } = resolveMonthRange(request.query);

    const [bookings, pickups, returns] = await Promise.all([
      calendarOrdersQuery(shopId)
        .whereBetween('o.booking_date', [from, to])
        .select(
          'o.id',
          'o.order_number',
          'o.pickup_name',
          knex.raw('c.name as customer_name'),
          knex.raw('c.address as customer_address'),
          knex.raw('o.booking_date as date'),
          'o.total_amount'
        ),
      calendarOrdersQuery(shopId)
        .whereBetween('o.pickup_date', [from, to])
        .select(
          'o.id',
          'o.order_number',
          'o.pickup_name',
          knex.raw('c.name as customer_name'),
          knex.raw('c.address as customer_address'),
          knex.raw('o.pickup_date as date')
        ),
      calendarOrdersQuery(shopId)
        .whereBetween('o.return_date', [from, to])
        .select(
          'o.id',
          'o.order_number',
          'o.pickup_name',
          knex.raw('c.name as customer_name'),
          knex.raw('c.address as customer_address'),
          knex.raw('o.return_date as date')
        ),
    ]);

    const addTo = (bucket, type) => (row) => {
      const key = toISO(row.date);
      if (!key) return;
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push({ type, ...row, date: key });
    };

    const byDay = {};
    const register = (rows, type) => rows.forEach(addTo(byDay, type));
    register(bookings, 'booking');
    register(pickups, 'pickup');
    register(returns, 'return');

    return { ok: true, data: { from, to, events: byDay } };
  });

  /** Monthly booking counts for dashboard trend chart (single query vs 12× /calendar). */
  fastify.get('/calendar-bookings-trend', async (request) => {
    const shopId = request.shopId;
    const months = Math.min(24, Math.max(1, Number(request.query.months || 12)));
    const end = new Date();
    end.setDate(1);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setMonth(start.getMonth() - (months - 1));

    const rows = await calendarOrdersQuery(shopId)
      .whereBetween('o.booking_date', [toISO(start), toISO(end)])
      .select(knex.raw("DATE_FORMAT(o.booking_date, '%Y-%m') as month"))
      .count({ bookings: 'o.id' })
      .groupByRaw("DATE_FORMAT(o.booking_date, '%Y-%m')")
      .orderBy('month', 'asc');

    const map = new Map(rows.map((r) => [String(r.month), Number(r.bookings || 0)]));
    const series = [];
    for (let i = 0; i < months; i += 1) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      const key = toIndiaYearMonth(d);
      series.push({ month: key, bookings: map.get(key) || 0 });
    }
    return { ok: true, data: series };
  });

  /** Daily revenue (payments) series for a range. */
  fastify.get('/revenue-series', async (request) => {
    const shopId = request.shopId;
    const days = Math.min(365, Math.max(7, Number(request.query.days || 30)));
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));

    const rows = await knex('payments')
      .where({ shop_id: shopId, is_deleted: false })
      .whereBetween('payment_date', [toISO(start), toISO(end)])
      .whereIn('category', ['advance', 'partial', 'final'])
      .select('payment_date as date')
      .sum({ total: 'amount' })
      .groupBy('payment_date')
      .orderBy('payment_date', 'asc');

    const map = new Map(rows.map((r) => [toISO(r.date), Number(r.total || 0)]));
    const series = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toISO(d);
      series.push({ date: iso, total: map.get(iso) || 0 });
    }
    return { ok: true, data: series };
  });

  /** Recent shop activity — orders, payments, returns, and system logs. */
  fastify.get('/activity', async (request) => {
    const shopId = request.shopId;
    const limit = Math.min(50, Math.max(5, Number(request.query.limit || 15)));
    const logLimit = Math.min(25, limit);

    const [recentOrders, recentPayments, recentReturns, recentSystemLogs] = await Promise.all([
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false })
          .orderBy('created_at', 'desc')
          .limit(limit)
          .select('id', 'order_number', 'pickup_name', 'total_amount', 'status', 'created_at'),
        knex('payments')
          .where({ shop_id: shopId, is_deleted: false })
          .orderBy('created_at', 'desc')
          .limit(limit)
          .select('id', 'order_id', 'amount', 'payment_type', 'category', 'created_at'),
        knex('orders')
          .where({ shop_id: shopId, is_deleted: false, status: 'returned' })
          .orderBy('updated_at', 'desc')
          .limit(limit)
          .select('id', 'order_number', 'pickup_name', 'updated_at'),
        knex('system_logs')
          .where({ shop_id: shopId })
          .orderBy('created_at', 'desc')
          .limit(logLimit)
          .select(
            'id',
            'module',
            'action_type',
            'user_name',
            'bill_no',
            'entity_id',
            'created_at'
          ),
      ]);

    const stream = [
      ...recentOrders.map((o) => ({
        kind: 'order',
        at: o.created_at,
        title: `Order ${o.order_number}`,
        subtitle: o.pickup_name || '',
        amount: Number(o.total_amount || 0),
        status: o.status,
        id: o.id,
        entity_id: o.id,
        module: null,
      })),
      ...recentPayments.map((p) => ({
        kind: 'payment',
        at: p.created_at,
        title: `Payment ${p.category || 'recorded'}`,
        subtitle: String(p.payment_type || '').toUpperCase(),
        amount: Number(p.amount || 0),
        id: p.order_id,
        entity_id: p.order_id,
        module: null,
      })),
      ...recentReturns.map((r) => ({
        kind: 'return',
        at: r.updated_at,
        title: `Returned ${r.order_number}`,
        subtitle: r.pickup_name || '',
        id: r.id,
        entity_id: r.id,
        module: null,
      })),
      ...recentSystemLogs.map((row) => mapSystemLogActivity(row)),
    ]
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);

    return { ok: true, data: { alerts: [], stream } };
  });
}

function systemLogModuleLabel(module) {
  const key = String(module || '').trim();
  const found = SYSTEM_LOG_MODULES.find((m) => m.value === key);
  return found?.label || key || 'Record';
}

function mapSystemLogActivity(row) {
  const module = String(row.module || '').trim();
  const action = systemLogActionLabel(row.action_type);
  const moduleLabel = systemLogModuleLabel(module);
  const parts = [];
  if (row.user_name) parts.push(`by ${row.user_name}`);
  if (row.bill_no) parts.push(String(row.bill_no));
  const entityId = row.entity_id || null;
  let navId = null;
  if (module === 'booking' && entityId) navId = entityId;
  return {
    kind: 'system_log',
    at: row.created_at,
    title: `${moduleLabel} · ${action}`,
    subtitle: parts.join(' · '),
    id: navId || row.id,
    entity_id: entityId,
    module,
    log_id: row.id,
  };
}

function num(v) {
  return Number(v || 0);
}

function toISO(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try {
    return toLocalISODate(d);
  } catch {
    return null;
  }
}

function resolveMonthRange({ from, to, month }) {
  if (from && to) return { from, to };
  const base = month ? new Date(`${month}-01`) : new Date();
  base.setHours(0, 0, 0, 0);
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { from: toISO(first), to: toISO(last) };
}

/** Orders joined to customer for dashboard calendar event labels. */
function calendarOrdersQuery(shopId) {
  return knex('orders as o')
    .leftJoin('customers as c', function joinCustomer() {
      this.on('c.id', '=', 'o.customer_id').andOn('c.shop_id', '=', 'o.shop_id');
    })
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false });
}
