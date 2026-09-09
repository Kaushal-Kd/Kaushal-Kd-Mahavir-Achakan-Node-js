import { invalidateBillNotesCache } from '../utils/printBill.js';

import { queryKeys } from './queryKeys.js';

const REFETCH_ACTIVE = { refetchType: 'active' };

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {string} queryKey
 * @param {import('@tanstack/react-query').InvalidateQueryFilters} [opts]
 */
async function invalidatePrefix(qc, queryKey, opts = REFETCH_ACTIVE) {
  await qc.invalidateQueries({ queryKey, ...opts });
}

/**
 * Order list screens only (booking, delivery, return, item stages, booked products).
 * @param {import('@tanstack/react-query').QueryClient} qc
 */
export async function invalidateOrderListQueries(qc) {
  await invalidatePrefix(qc, queryKeys.orders.all);
  await invalidatePrefix(qc, queryKeys.itemStages.collectAll);
  await invalidatePrefix(qc, queryKeys.itemStages.prepareAll);
  await invalidatePrefix(qc, queryKeys.delivery.all);
  await invalidatePrefix(qc, queryKeys.return.all);
  await invalidatePrefix(qc, queryKeys.bookedProducts.all);
}

/**
 * Dashboard widgets tied to orders.
 * @param {import('@tanstack/react-query').QueryClient} qc
 */
export async function invalidateOrderDashboardQueries(qc) {
  await invalidatePrefix(qc, queryKeys.dashboard.all);
  await invalidatePrefix(qc, ['dashboard-bookings-month']);
  await invalidatePrefix(qc, ['dashboard-booking-earning']);
  await invalidatePrefix(qc, ['dashboard-calendar']);
}

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {string} orderId
 */
export async function invalidateOrderDetailQueries(qc, orderId) {
  if (!orderId) return;
  await invalidatePrefix(qc, queryKeys.orders.detail(orderId));
  await invalidatePrefix(qc, queryKeys.orders.edit(orderId));
  await invalidatePrefix(qc, queryKeys.orders.settlement(orderId));
  await invalidatePrefix(qc, queryKeys.orders.deliverySettlement(orderId));
  await invalidatePrefix(qc, queryKeys.orders.returnSettlement(orderId));
  await invalidatePrefix(qc, queryKeys.orders.cancelSummary(orderId));
  await invalidatePrefix(qc, queryKeys.orders.transactions(orderId));
  await invalidatePrefix(qc, queryKeys.orders.securityTransactions(orderId));
}

/**
 * Booking, checklist, delivery, return, item-stage lists, and dashboard booking widgets.
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {{ orderId?: string, includeDashboard?: boolean, includeReports?: boolean }} [opts]
 */
export async function invalidateOrderDomain(
  qc,
  { orderId, includeDashboard = true, includeReports = true } = {}
) {
  await invalidateOrderListQueries(qc);
  if (includeDashboard) {
    await invalidateOrderDashboardQueries(qc);
  }
  if (includeReports) {
    await invalidatePrefix(qc, queryKeys.creditNotes.all);
    await invalidatePrefix(qc, queryKeys.reports.pendingBills);
  }
  await invalidatePrefix(qc, queryKeys.accessories.all);
  await invalidatePrefix(qc, queryKeys.products.all);
  await invalidatePrefix(qc, ['inventory-snapshot']);
  await invalidatePrefix(qc, ['order-replacements']);
  await invalidatePrefix(qc, ['reminders']);
  if (orderId) {
    await invalidateOrderDetailQueries(qc, orderId);
  }
}

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {{ saleId?: string }} [opts]
 */
export async function invalidateSalesDomain(qc, { saleId } = {}) {
  await invalidatePrefix(qc, queryKeys.sales.all);
  await invalidatePrefix(qc, queryKeys.accessories.all);
  await invalidatePrefix(qc, queryKeys.products.all);
  await invalidatePrefix(qc, ['inventory-snapshot']);
  if (saleId) {
    await invalidatePrefix(qc, queryKeys.sales.detail(saleId));
  }
}

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {{ productId?: string, accessoryId?: string }} [opts]
 */
export async function invalidateCatalogDomain(qc, { productId, accessoryId } = {}) {
  await invalidatePrefix(qc, queryKeys.products.all);
  await invalidatePrefix(qc, ['categories']);
  if (productId) {
    await invalidatePrefix(qc, queryKeys.products.detail(productId));
  }
  if (accessoryId) {
    await invalidatePrefix(qc, queryKeys.accessories.detail(accessoryId));
  }
  await invalidatePrefix(qc, queryKeys.accessories.all);
}

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {{ customerId?: string }} [opts]
 */
export async function invalidateCustomersDomain(qc, { customerId } = {}) {
  await invalidatePrefix(qc, queryKeys.customers.all);
  await invalidatePrefix(qc, queryKeys.customers.search);
  if (customerId) {
    await invalidatePrefix(qc, queryKeys.customers.detail(customerId));
  }
}

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {{ orderId?: string }} [opts]
 */
export async function invalidateCustomOrdersDomain(qc, { orderId } = {}) {
  await invalidatePrefix(qc, ['custom-orders']);
  await invalidatePrefix(qc, ['custom-orders', 'trial-reminders']);
  if (orderId) {
    await invalidatePrefix(qc, ['custom-order', orderId]);
  }
}

/**
 * Income, expense, vouchers, payment accounts, and related reports.
 * @param {import('@tanstack/react-query').QueryClient} qc
 */
export async function invalidateSecurityChargesDomain(qc, { orderId } = {}) {
  await invalidatePrefix(qc, ['security-charges']);
  await invalidatePrefix(qc, ['security-due']);
  await invalidatePrefix(qc, ['security-transactions']);
  if (orderId) {
    await invalidatePrefix(qc, queryKeys.orders.returnSettlement(orderId));
    await invalidatePrefix(qc, queryKeys.orders.detail(orderId));
  }
}

export async function invalidateAccountingDomain(qc) {
  await invalidatePrefix(qc, queryKeys.incomeEntries.all);
  await invalidatePrefix(qc, queryKeys.expenseEntries.all);
  await invalidatePrefix(qc, queryKeys.journalVouchers.all);
  await invalidatePrefix(qc, queryKeys.paymentVouchers.all);
  await invalidatePrefix(qc, queryKeys.receiptVouchers.all);
  await invalidatePrefix(qc, queryKeys.paymentAccounts.all);
  await invalidatePrefix(qc, queryKeys.reports.incomeExpense);
  await invalidatePrefix(qc, queryKeys.reports.pendingBills);
}

/**
 * @param {import('@tanstack/react-query').QueryClient} qc
 */
export async function invalidateLaundryDomain(qc) {
  await invalidatePrefix(qc, ['laundry-jobs']);
  await invalidatePrefix(qc, ['washing-queue']);
  await invalidatePrefix(qc, ['laundry-job']);
}

/**
 * Refetch screens that read a saved app setting (Settings → App Settings).
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {string} key
 */
export async function invalidateAppSettingConsumers(qc, key) {
  const settingKey = String(key || '').trim();
  await invalidatePrefix(qc, ['app-settings']);

  if (settingKey.startsWith('DASHBOARD_')) {
    await invalidatePrefix(qc, queryKeys.dashboard.all);
  }

  if (settingKey === 'BILL_NOTES') {
    invalidateBillNotesCache();
    await invalidatePrefix(qc, ['app-settings', 'bill-template-preview']);
  }

  if (settingKey === 'LOW_STOCK_LIMIT_QUANTITY') {
    await invalidatePrefix(qc, queryKeys.accessories.all);
    await invalidatePrefix(qc, queryKeys.dashboard.all);
  }

  if (settingKey === 'CHECKLIST_NEXT_BOOKING_ALERT_DAYS') {
    await invalidateOrderListQueries(qc);
  }
}
