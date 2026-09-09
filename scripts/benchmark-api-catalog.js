/**
 * GET endpoints to benchmark, grouped by module.
 * Paths are relative to API_BASE (include /api prefix).
 */

import { monthIso, todayIso } from './perf-report-utils.js';

export function buildBenchmarkCatalog(ctx = {}) {
  const today = todayIso();
  const month = monthIso(0);
  const orderId = ctx.orderId || '00000000-0000-4000-8000-000000000001';
  const productId = ctx.productId || '00000000-0000-4000-8000-000000000002';

  return [
    // Dashboard
    {
      name: 'GET /api/dashboard',
      group: 'dashboard',
      path: '/api/dashboard',
      risk: '11 parallel DB aggregations',
    },
    {
      name: 'GET /api/dashboard/calendar-bookings-trend',
      group: 'dashboard',
      path: '/api/dashboard/calendar-bookings-trend?months=12',
      risk: 'Single query for 12-month booking chart',
    },
    {
      name: 'GET /api/dashboard/calendar',
      group: 'dashboard',
      path: `/api/dashboard/calendar?month=${month}`,
      risk: 'Calendar day view (one month)',
    },
    {
      name: 'GET /api/dashboard/revenue-series',
      group: 'dashboard',
      path: `/api/dashboard/revenue-series?from=${today.slice(0, 7)}-01&to=${today}`,
      risk: 'Revenue chart',
    },
    {
      name: 'GET /api/dashboard/activity',
      group: 'dashboard',
      path: '/api/dashboard/activity?limit=25',
      risk: 'Activity feed',
    },

    // Orders
    {
      name: 'GET /api/orders (lean)',
      group: 'orders',
      path: '/api/orders?per_page=25&lean=1&with_next_booking_alerts=1',
      risk: 'Booking list optimized',
    },
    {
      name: 'GET /api/orders (full)',
      group: 'orders',
      path: '/api/orders?per_page=25&with_next_booking_alerts=1',
      risk: 'Correlated subqueries per row',
    },
    {
      name: 'GET /api/orders (delivery)',
      group: 'orders',
      path: `/api/orders?per_page=25&date_field=pickup_date&statuses=in_preparation,ready_for_delivery,delivered&from=${today}&to=${today}`,
      risk: 'Delivery list without lean',
    },
    {
      name: 'GET /api/orders/items-to-collect?lines=1',
      group: 'orders',
      path: `/api/orders/items-to-collect?lines=1&per_page=20&pickup_from=${today}&pickup_to=${today}`,
      risk: 'JSON_EXTRACT stage_flags + enrichment',
    },
    {
      name: 'GET /api/orders/items-to-collect?lines=1&skip_enrich',
      group: 'orders',
      path: `/api/orders/items-to-collect?lines=1&per_page=20&skip_enrich=1&pickup_from=${today}&pickup_to=${today}`,
      risk: 'Table view without enrichment',
    },
    {
      name: 'GET /api/orders/items-to-prepare?lines=1',
      group: 'orders',
      path: `/api/orders/items-to-prepare?lines=1&per_page=20&pickup_from=${today}&pickup_to=${today}`,
      risk: 'Same enrichment stack as collect',
    },
    {
      name: 'GET /api/orders/booked-products',
      group: 'orders',
      path: '/api/orders/booked-products?per_page=25',
      risk: 'Booked products list',
    },
    ...(ctx.orderId
      ? [
          {
            name: 'GET /api/orders/:id',
            group: 'orders',
            path: `/api/orders/${orderId}`,
            risk: 'Full order with items',
          },
        ]
      : []),

    // Products
    {
      name: 'GET /api/products',
      group: 'products',
      path: '/api/products?per_page=25',
      risk: '4 inventory subqueries per row',
    },
    {
      name: 'GET /api/products (lean)',
      group: 'products',
      path: '/api/products?per_page=25&lean=1',
      risk: 'Light list without inventory joins',
    },
    {
      name: 'GET /api/products/inventory',
      group: 'products',
      path: '/api/products/inventory?per_page=25',
      risk: 'Inventory snapshot — filters in Node',
    },
    {
      name: 'GET /api/products/availability-list',
      group: 'products',
      path: `/api/products/availability-list?from=${today}&to=${today}&per_page=25`,
      risk: 'Availability grid',
    },
    {
      name: 'GET /api/products/booking-availability',
      group: 'products',
      path: `/api/products/booking-availability?from=${today}&to=${today}&search=a&per_page=20`,
      risk: 'CreateOrder product search',
    },
    {
      name: 'GET /api/products/category-counts',
      group: 'products',
      path: '/api/products/category-counts',
      risk: 'Product list sidebar',
    },
    {
      name: 'GET /api/products/pending-washing',
      group: 'products',
      path: '/api/products/pending-washing?per_page=25',
      risk: 'Washing queue products',
    },
    {
      name: 'GET /api/products/code-format',
      group: 'products',
      path: '/api/products/code-format',
      risk: 'Config lookup',
    },

    // Reports
    {
      name: 'GET /api/reports/income-expense',
      group: 'reports',
      path: `/api/reports/income-expense?from=${today.slice(0, 7)}-01&to=${today}`,
      risk: '18 parallel DB calls',
    },
    {
      name: 'GET /api/reports/account-ledger',
      group: 'reports',
      path: `/api/reports/account-ledger?from=${today.slice(0, 7)}-01&to=${today}&account_id=00000000-0000-4000-8000-000000000099`,
      risk: 'Multi-source ledger (needs valid account_id in prod)',
      optional: true,
    },
    {
      name: 'GET /api/reports/trial-balance',
      group: 'reports',
      path: `/api/reports/trial-balance?from=${today.slice(0, 7)}-01&to=${today}`,
      risk: '13-leg UNION ALL',
    },
    {
      name: 'GET /api/reports/product-performance',
      group: 'reports',
      path: `/api/reports/product-performance?from=${today.slice(0, 7)}-01&to=${today}&per_page=25`,
      risk: 'Product performance',
    },
    {
      name: 'GET /api/reports/pending-bills',
      group: 'reports',
      path: '/api/reports/pending-bills?per_page=25',
      risk: 'Pending bills',
    },
    {
      name: 'GET /api/reports/salesman',
      group: 'reports',
      path: `/api/reports/salesman?month=${month}`,
      risk: 'Salesman report',
    },
    {
      name: 'GET /api/reports/daily-cashbook',
      group: 'reports',
      path: `/api/reports/daily-cashbook?date=${today}`,
      risk: 'Daily cashbook',
    },
    {
      name: 'GET /api/reports/inventory',
      group: 'reports',
      path: '/api/reports/inventory',
      risk: 'Inventory report',
    },

    // Ops
    {
      name: 'GET /api/washing-queue',
      group: 'ops',
      path: '/api/washing-queue',
      risk: 'Unpaginated full queue',
    },
    {
      name: 'GET /api/payments/security-due',
      group: 'ops',
      path: '/api/payments/security-due?per_page=25',
      risk: 'Correlated charge subquery per row',
    },
    {
      name: 'GET /api/payments/security-transactions',
      group: 'ops',
      path: '/api/payments/security-transactions?per_page=25',
      risk: 'Security transactions',
    },
    {
      name: 'GET /api/laundry',
      group: 'ops',
      path: '/api/laundry?per_page=25',
      risk: 'Laundry jobs list',
    },
    {
      name: 'GET /api/sales',
      group: 'ops',
      path: '/api/sales?per_page=25',
      risk: 'Sales list',
    },
    {
      name: 'GET /api/purchases',
      group: 'ops',
      path: '/api/purchases?per_page=25',
      risk: 'Purchases list',
    },
    {
      name: 'GET /api/security-charges',
      group: 'ops',
      path: '/api/security-charges?per_page=25',
      risk: 'Security charges',
    },

    // Bootstrap / config (duplicated across pages)
    {
      name: 'GET /api/configurations/app-settings',
      group: 'bootstrap',
      path: '/api/configurations/app-settings',
      risk: 'Fetched on most pages',
    },
    {
      name: 'GET /api/configurations/colors',
      group: 'bootstrap',
      path: '/api/configurations/colors',
      risk: 'Product forms/lists',
    },
    {
      name: 'GET /api/configurations/sizes',
      group: 'bootstrap',
      path: '/api/configurations/sizes',
      risk: 'Product forms/lists',
    },
    {
      name: 'GET /api/categories?type=product',
      group: 'bootstrap',
      path: '/api/categories?type=product',
      risk: 'Shared across lists',
    },
    {
      name: 'GET /api/categories?type=accessory',
      group: 'bootstrap',
      path: '/api/categories?type=accessory',
      risk: 'Accessory lists',
    },
    {
      name: 'GET /api/payment-accounts',
      group: 'bootstrap',
      path: '/api/payment-accounts',
      risk: 'Booking/sales forms',
    },
    {
      name: 'GET /api/security-accounts',
      group: 'bootstrap',
      path: '/api/security-accounts',
      risk: 'Booking form',
    },
    {
      name: 'GET /api/time-slots',
      group: 'bootstrap',
      path: '/api/time-slots',
      risk: 'Booking form',
    },
    {
      name: 'GET /api/users',
      group: 'bootstrap',
      path: '/api/users?per_page=200',
      risk: 'Salesman dropdowns',
    },
    {
      name: 'GET /api/drafts?kind=availability_cart',
      group: 'bootstrap',
      path: '/api/drafts?kind=availability_cart',
      risk: 'TopBar + Dashboard',
    },

    // Other lists
    {
      name: 'GET /api/customers',
      group: 'lists',
      path: '/api/customers?per_page=25',
      risk: 'Customer list',
    },
    {
      name: 'GET /api/accessories',
      group: 'lists',
      path: '/api/accessories?per_page=25',
      risk: 'Accessory list',
    },
    {
      name: 'GET /api/custom-orders',
      group: 'lists',
      path: '/api/custom-orders?per_page=25',
      risk: 'Custom orders',
    },
    {
      name: 'GET /api/custom-orders/trial-reminders',
      group: 'lists',
      path: '/api/custom-orders/trial-reminders',
      risk: 'Dashboard card',
    },
    {
      name: 'GET /api/reminders',
      group: 'lists',
      path: '/api/reminders',
      risk: 'Dashboard reminders',
    },
    {
      name: 'GET /api/system-logs',
      group: 'lists',
      path: '/api/system-logs?per_page=25',
      risk: 'Audit logs',
    },
    {
      name: 'GET /api/income-entries',
      group: 'lists',
      path: '/api/income-entries?per_page=25',
      risk: 'Income list',
    },
    {
      name: 'GET /api/expense-entries',
      group: 'lists',
      path: '/api/expense-entries?per_page=25',
      risk: 'Expense list',
    },
    {
      name: 'GET /api/journal-vouchers',
      group: 'lists',
      path: '/api/journal-vouchers?per_page=25',
      risk: 'Journal vouchers',
    },
    {
      name: 'GET /api/receipt-vouchers',
      group: 'lists',
      path: '/api/receipt-vouchers?per_page=25',
      risk: 'Receipt vouchers',
    },
    {
      name: 'GET /api/payment-vouchers',
      group: 'lists',
      path: '/api/payment-vouchers?per_page=25',
      risk: 'Payment vouchers',
    },
    {
      name: 'GET /api/credit-notes',
      group: 'lists',
      path: '/api/credit-notes?per_page=25',
      risk: 'Credit notes',
    },
    {
      name: 'GET /api/whatsapp/connection',
      group: 'lists',
      path: '/api/whatsapp/connection',
      risk: 'Global WhatsApp provider',
    },
    {
      name: 'GET /api/configurations/whatsapp-messages',
      group: 'lists',
      path: '/api/configurations/whatsapp-messages',
      risk: 'Global WhatsApp provider',
    },
  ];
}
