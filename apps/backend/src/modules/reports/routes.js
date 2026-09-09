import {
  accountLedgerQuerySchema,
  dailyCashbookLinesQuerySchema,
  dailyCashbookQuerySchema,
  cashReconciliationBodySchema,
  cashReconciliationQuerySchema,
  incomeExpenseQuerySchema,
  pendingBillsQuerySchema,
  productHistoryQuerySchema,
  productPerformanceQuerySchema,
  salesmanReportQuerySchema,
  trialBalanceQuerySchema,
  addDays,
  todayIndiaISODate,
  toLocalISODate,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { validate } from '../../utils/validate.js';

import { getAccountLedgerReport } from './accountLedgerService.js';
import { getDailyCashbookAccountLines, getDailyCashbookReport } from './dailyCashbookService.js';
import { createCashReconciliation, listCashReconciliations } from './cashReconciliationService.js';
import { verifyShopAdminPassword } from '../../utils/shopAdmin.js';
import { getIncomeExpenseReport } from './incomeExpenseService.js';
import { listPendingBills } from './pendingBillsService.js';
import { getProductHistoryReport } from './productHistoryService.js';
import { getProductPerformanceReport } from './productPerformanceService.js';
import { getSalesmanReport } from './salesmanReportService.js';
import { getTrialBalanceReport } from './trialBalanceService.js';

export default async function reportRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  /**
   * Sales / rental report for a date range.
   * Groups orders by booking_date and sums totals.
   */
  fastify.get('/sales', async (request) => {
    const { from, to } = resolveRange(request.query);
    const shopId = request.shopId;

    const rows = await knex('orders')
      .where({ shop_id: shopId, is_deleted: false })
      .whereBetween('booking_date', [from, to])
      .whereNot('status', 'cancelled')
      .select(
        'booking_date',
        knex.raw('COUNT(*) as orders'),
        knex.raw('SUM(total_amount) as total'),
        knex.raw('SUM(paid_amount) as paid'),
        knex.raw('SUM(balance) as balance')
      )
      .groupBy('booking_date')
      .orderBy('booking_date', 'asc');

    const summary = rows.reduce(
      (acc, r) => {
        acc.orders += Number(r.orders || 0);
        acc.total += Number(r.total || 0);
        acc.paid += Number(r.paid || 0);
        acc.balance += Number(r.balance || 0);
        return acc;
      },
      { orders: 0, total: 0, paid: 0, balance: 0 }
    );

    return { ok: true, data: { range: { from, to }, summary, rows } };
  });

  /** Rental-only report (type=rent) with item-level breakdown. */
  fastify.get('/rental', async (request) => {
    const { from, to } = resolveRange(request.query);
    const shopId = request.shopId;

    const topProducts = await knex('order_items as oi')
      .join('orders as o', 'o.id', 'oi.order_id')
      .where('o.shop_id', shopId)
      .andWhere('o.is_deleted', false)
      .whereNotIn('o.status', ['cancelled'])
      .whereBetween('o.booking_date', [from, to])
      .andWhere('oi.type', 'rent')
      .groupBy('oi.product_id', 'oi.name_snapshot')
      .select(
        'oi.product_id',
        'oi.name_snapshot as name',
        knex.raw('SUM(oi.qty) as qty'),
        knex.raw('SUM(oi.line_total) as revenue')
      )
      .orderBy('revenue', 'desc')
      .limit(50);

    return { ok: true, data: { range: { from, to }, top_products: topProducts } };
  });

  /** Payments report grouped by day + by mode. */
  fastify.get('/payments', async (request) => {
    const { from, to } = resolveRange(request.query);
    const shopId = request.shopId;

    const byDay = await knex('payments')
      .where({ shop_id: shopId, is_deleted: false })
      .whereBetween('payment_date', [from, to])
      .select(
        'payment_date',
        knex.raw(
          "SUM(CASE WHEN purchase_id IS NULL AND category IN ('advance','partial','final','deposit') THEN amount ELSE 0 END) as credit"
        ),
        knex.raw(
          "SUM(CASE WHEN category IN ('refund','deposit_refund') OR (purchase_id IS NOT NULL AND category IN ('advance','partial','final','deposit')) THEN amount ELSE 0 END) as debit"
        )
      )
      .groupBy('payment_date')
      .orderBy('payment_date', 'asc');

    const byMode = await knex('payments')
      .where({ shop_id: shopId, is_deleted: false })
      .whereBetween('payment_date', [from, to])
      .select('payment_type', knex.raw('SUM(amount) as total'))
      .groupBy('payment_type');

    return { ok: true, data: { range: { from, to }, by_day: byDay, by_mode: byMode } };
  });

  /** Outstanding dues list — orders with balance > 0. */
  fastify.get('/dues', async (request) => {
    const base = knex('orders')
      .where({ shop_id: request.shopId, is_deleted: false })
      .andWhere('balance', '>', 0)
      .whereNotIn('status', ['cancelled']);

    const [summaryRow, rows] = await Promise.all([
      base.clone().clearSelect().clearOrder()
        .select(
          knex.raw('COUNT(*) as count'),
          knex.raw('COALESCE(SUM(balance), 0) as balance')
        )
        .first(),
      base.clone()
        .select(
          'id',
          'order_number',
          'booking_date',
          'return_date',
          'pickup_name',
          'pickup_number',
          'total_amount',
          'paid_amount',
          'balance',
          'status',
          'payment_status'
        )
        .orderBy('return_date', 'asc')
        .limit(500),
    ]);

    return {
      ok: true,
      data: {
        rows,
        summary: {
          balance: Number(summaryRow?.balance || 0),
          count: Number(summaryRow?.count || 0),
        },
      },
    };
  });

  /** Salesman performance by day — booking lines or standalone sales (General Report). */
  fastify.get('/salesman', async (request) => {
    const query = validate(salesmanReportQuerySchema, request.query || {});
    const data = await getSalesmanReport(request.shopId, query);
    return { ok: true, data };
  });

  /** Product summary + lifetime rent stats (General Report). */
  fastify.get('/product-history', async (request) => {
    const query = validate(productHistoryQuerySchema, request.query || {});
    const data = await getProductHistoryReport(request.shopId, query);
    return { ok: true, data };
  });

  /** Per-product rent/sale metrics for a booking_date window (Finance Report). */
  fastify.get('/product-performance', async (request) => {
    const query = validate(productPerformanceQuerySchema, request.query || {});
    const range = resolveRange(query);
    const data = await getProductPerformanceReport(request.shopId, range, query);
    return { ok: true, data };
  });

  /** Orders returned (or closed) with balance still due — Finance Report. */
  fastify.get('/pending-bills', async (request) => {
    const query = validate(pendingBillsQuerySchema, request.query || {});
    const data = await listPendingBills(request.shopId, query);
    return { ok: true, data };
  });

  /** Ledger + booking payments: income vs expense with cash/bank summary. */
  fastify.get('/income-expense', async (request) => {
    const query = validate(incomeExpenseQuerySchema, request.query || {});
    const data = await getIncomeExpenseReport(request.shopId, query);
    return { ok: true, data };
  });

  /** Dr/Cr lines for one payment account (journal, receipt, income/expense, booking payments). */
  fastify.get('/account-ledger', async (request) => {
    const query = validate(accountLedgerQuerySchema, request.query || {});
    const data = await getAccountLedgerReport(request.shopId, query);
    return { ok: true, data };
  });

  /** Line-level income/expense for one payment account on one day. */
  fastify.get('/daily-cashbook/lines', async (request) => {
    const query = validate(dailyCashbookLinesQuerySchema, request.query || {});
    const data = await getDailyCashbookAccountLines(request.shopId, query);
    return { ok: true, data };
  });

  /** Per payment account: income vs expense for one day (cashbook view). */
  fastify.get('/daily-cashbook', async (request) => {
    const query = validate(dailyCashbookQuerySchema, request.query || {});
    const data = await getDailyCashbookReport(request.shopId, query);
    return { ok: true, data };
  });

  fastify.get('/daily-cashbook/reconciliations', async (request) => {
    const query = validate(cashReconciliationQuerySchema, request.query || {});
    const data = await listCashReconciliations(request.shopId, query);
    return { ok: true, data };
  });

  fastify.post('/daily-cashbook/reconciliations', async (request) => {
    const body = validate(cashReconciliationBodySchema, request.body || {});
    const data = await createCashReconciliation({
      shopId: request.shopId,
      userId: request.authUser.id,
      body,
      authorizeRevision: (password) => verifyShopAdminPassword(request.shopId, password),
    });
    await request.audit('cash_counter_reconciliation', Number(data.version) > 1 ? 'UPDATE' : 'CREATE', {
      id: data.id,
      new: data,
    });
    return { ok: true, data };
  });

  /** All payment accounts: opening, period Dr/Cr, closing (same movement rules as account ledger). */
  fastify.get('/trial-balance', async (request) => {
    const query = validate(trialBalanceQuerySchema, request.query || {});
    const data = await getTrialBalanceReport(request.shopId, query);
    return { ok: true, data };
  });

  /** Inventory valuation snapshot. */
  fastify.get('/inventory', async (request) => {
    const shopId = request.shopId;

    const [products, accessoryAgg] = await Promise.all([
      knex('products')
        .where({ shop_id: shopId, is_active: true })
        .select(
          'status',
          knex.raw('SUM(qty) as qty'),
          knex.raw('SUM(qty * price_rent) as rent_value'),
          knex.raw('SUM(qty * purchase_price) as purchase_value')
        )
        .groupBy('status'),
      knex('accessories')
        .where({ shop_id: shopId, is_active: true })
        .select(
          knex.raw('SUM(qty) as qty'),
          knex.raw('SUM(qty * price_sell) as sell_value'),
          knex.raw('SUM(qty * purchase_price) as purchase_value')
        )
        .first(),
    ]);

    return { ok: true, data: { products, accessories: accessoryAgg } };
  });
}

function resolveRange(q) {
  const to = q.to || todayIndiaISODate();
  const from = q.from || toLocalISODate(addDays(new Date(), -30));
  return { from, to };
}
