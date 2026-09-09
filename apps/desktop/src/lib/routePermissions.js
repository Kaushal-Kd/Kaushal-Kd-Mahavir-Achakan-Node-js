import { ACTIONS, hasPermission, MODULES } from '@wrs/shared/constants';

/**
 * @typedef {{ module: string, action?: string }} RoutePermission
 */

/** Most specific rules first. */
const ROUTE_RULES = [
  { test: (p) => p === '/booking/new', module: MODULES.BOOKING, action: ACTIONS.CREATE },
  { test: (p) => p === '/booking/quick-accessory', module: MODULES.BOOKING, action: ACTIONS.CREATE },
  { test: (p) => /^\/booking\/[^/]+\/edit$/.test(p), module: MODULES.BOOKING, action: ACTIONS.EDIT },
  { test: (p) => p.startsWith('/booking/'), module: MODULES.BOOKING, action: ACTIONS.VIEW },
  { test: (p) => p === '/booking', module: MODULES.BOOKING, action: ACTIONS.VIEW },

  { test: (p) => p === '/sales/new' || /^\/sales\/[^/]+\/edit$/.test(p), module: MODULES.SALES, action: ACTIONS.EDIT },
  { test: (p) => p.startsWith('/sales'), module: MODULES.SALES, action: ACTIONS.VIEW },

  { test: (p) => p === '/purchases/new' || /^\/purchases\/[^/]+\/edit$/.test(p), module: MODULES.PURCHASES, action: ACTIONS.EDIT },
  { test: (p) => p.startsWith('/purchases'), module: MODULES.PURCHASES, action: ACTIONS.VIEW },

  { test: (p) => p === '/products/new' || /^\/products\/[^/]+\/edit$/.test(p), module: MODULES.PRODUCTS, action: ACTIONS.EDIT },
  { test: (p) => p.startsWith('/products'), module: MODULES.PRODUCTS, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/master/accessory'), module: MODULES.ACCESSORIES, action: ACTIONS.VIEW },
  { test: (p) => /^\/master\/accessory\/[^/]+\/edit$/.test(p), module: MODULES.ACCESSORIES, action: ACTIONS.EDIT },

  { test: (p) => p === '/custom-orders/new' || /^\/custom-orders\/[^/]+\/edit$/.test(p), module: MODULES.CUSTOM_ORDERS, action: ACTIONS.EDIT },
  { test: (p) => p.startsWith('/custom-orders'), module: MODULES.CUSTOM_ORDERS, action: ACTIONS.VIEW },

  { test: (p) => p === '/customers/new' || /^\/customers\/[^/]+\/edit$/.test(p), module: MODULES.CUSTOMERS, action: ACTIONS.EDIT },
  { test: (p) => p.startsWith('/customers'), module: MODULES.CUSTOMERS, action: ACTIONS.VIEW },

  { test: (p) => p === '/laundry/new', module: MODULES.LAUNDRY, action: ACTIONS.CREATE },
  { test: (p) => p.startsWith('/laundry'), module: MODULES.LAUNDRY, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/inventory/bulk-upload'), module: MODULES.BULK_IMPORT, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/inventory'), module: MODULES.INVENTORY, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/availability') || p.startsWith('/products-available'), module: MODULES.AVAILABILITY, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/delivery'), module: MODULES.DELIVERY, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/return'), module: MODULES.RETURN, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/security-'), module: MODULES.SECURITY, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/income'), module: MODULES.INCOME, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/expense'), module: MODULES.EXPENSES, action: ACTIONS.VIEW },
  { test: (p) => p.includes('voucher'), module: MODULES.VOUCHERS, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/credit-notes'), module: MODULES.CREDIT_NOTES, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/reports'), module: MODULES.REPORTS, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/booked-products'), module: MODULES.BOOKING, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/item-to-collect'), module: MODULES.DELIVERY, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/items-to-prepare'), module: MODULES.BOOKING, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/product-history'), module: MODULES.REPORTS, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/salesman-report'), module: MODULES.REPORTS, action: ACTIONS.VIEW },

  { test: (p) => p === '/settings/permissions', module: MODULES.SETTINGS, action: ACTIONS.EDIT },
  { test: (p) => p === '/settings/ip-whitelisting', module: MODULES.SETTINGS, action: ACTIONS.EDIT },
  { test: (p) => p === '/settings/system-logs', module: MODULES.AUDIT_LOGS, action: ACTIONS.VIEW },
  { test: (p) => p === '/settings/shops', module: MODULES.SHOPS, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/settings'), module: MODULES.SETTINGS, action: ACTIONS.VIEW },

  { test: (p) => p === '/master/users', module: MODULES.USERS, action: ACTIONS.VIEW },
  { test: (p) => p === '/master/categories', module: MODULES.CATEGORIES, action: ACTIONS.VIEW },
  { test: (p) => p === '/master/custom-order-fields', module: MODULES.CUSTOM_ORDERS, action: ACTIONS.EDIT },
  { test: (p) => p === '/master/bill_templates', module: MODULES.BILL_TEMPLATES, action: ACTIONS.VIEW },
  { test: (p) => p === '/master/accounts', module: MODULES.ACCOUNTS, action: ACTIONS.VIEW },
  { test: (p) => p.startsWith('/master'), module: MODULES.SETTINGS, action: ACTIONS.VIEW },

  { test: (p) => p.startsWith('/dashboard') || p === '/', module: MODULES.DASHBOARD, action: ACTIONS.VIEW },
];

const MENU_ROUTE_RULES = [
  { test: (p) => p === '/', key: 'menu.dashboard' },
  { test: (p) => p.startsWith('/availability'), key: 'menu.check_availability' },
  { test: (p) => p.startsWith('/products-available'), key: 'menu.products_available' },
  { test: (p) => p.startsWith('/inventory/products-catalogue'), key: 'menu.products_catalogue' },
  { test: (p) => p.startsWith('/inventory/bulk-upload'), key: 'menu.bulk_import' },
  { test: (p) => p === '/inventory', key: 'menu.inventory' },
  { test: (p) => p.startsWith('/products'), key: 'menu.products' },
  { test: (p) => p.startsWith('/item-to-collect'), key: 'menu.item_to_collect' },
  { test: (p) => p.startsWith('/items-to-prepare'), key: 'menu.prepare_item' },
  { test: (p) => p.startsWith('/delivery'), key: 'menu.delivery' },
  { test: (p) => p.startsWith('/return'), key: 'menu.return' },
  { test: (p) => p.startsWith('/booked-products'), key: 'menu.booked_product' },
  { test: (p) => p.startsWith('/security-transactions'), key: 'menu.security_transaction' },
  { test: (p) => p.startsWith('/security-due'), key: 'menu.due_security' },
  { test: (p) => p.startsWith('/security-charges'), key: 'menu.missing_damage_charges' },
  { test: (p) => p.startsWith('/product-history'), key: 'menu.product_history' },
  { test: (p) => p.startsWith('/salesman-report'), key: 'menu.salesman_report' },
  { test: (p) => p.startsWith('/customers'), key: 'menu.customers' },
  { test: (p) => p.startsWith('/booking'), key: 'menu.bookings' },
  { test: (p) => p.startsWith('/sales'), key: 'menu.sales' },
  { test: (p) => p.startsWith('/custom-orders'), key: 'menu.custom_orders' },
  { test: (p) => p.startsWith('/purchases'), key: 'menu.purchases' },
  { test: (p) => p.startsWith('/income'), key: 'menu.income' },
  { test: (p) => p.startsWith('/expense'), key: 'menu.expense' },
  { test: (p) => p.startsWith('/laundry'), key: 'menu.washing' },
  { test: (p) => p.startsWith('/journal-vouchers'), key: 'menu.journal_vouchers' },
  { test: (p) => p.startsWith('/payment-vouchers'), key: 'menu.payment_voucher' },
  { test: (p) => p.startsWith('/receipt-vouchers'), key: 'menu.receipt_voucher' },
  { test: (p) => p.startsWith('/credit-notes'), key: 'menu.credit_notes' },
  { test: (p) => p.startsWith('/reports/daily-cashbook'), key: 'menu.daily_cashbook' },
  { test: (p) => p.startsWith('/reports/product-performance'), key: 'menu.product_performance' },
  { test: (p) => p.startsWith('/reports/pending-bills'), key: 'menu.pending_bills' },
  { test: (p) => p.startsWith('/reports/income-expense'), key: 'menu.income_expense' },
  { test: (p) => p.startsWith('/reports/account-ledger'), key: 'menu.account_ledger' },
  { test: (p) => p.startsWith('/reports/trial-balance'), key: 'menu.trial_balance' },
  { test: (p) => p.startsWith('/reports/gst'), key: 'menu.gst_report' },
];

export function resolveMenuPermission(pathname) {
  const path = String(pathname || '').replace(/\/$/, '') || '/';
  const masterTab = path.match(/^\/master\/([^/]+)/)?.[1];
  if (masterTab) return MASTER_TAB_MENU_KEYS[masterTab] || null;
  const settingsTab = path.match(/^\/settings\/([^/]+)/)?.[1];
  if (settingsTab) return SETTINGS_TAB_MENU_KEYS[settingsTab] || null;
  return MENU_ROUTE_RULES.find((rule) => rule.test(path))?.key || null;
}

/**
 * @param {string} pathname
 * @returns {RoutePermission | null}
 */
export function resolveRoutePermission(pathname) {
  const path = String(pathname || '').replace(/\/$/, '') || '/';
  for (const rule of ROUTE_RULES) {
    if (rule.test(path)) {
      return { module: rule.module, action: rule.action || ACTIONS.VIEW };
    }
  }
  return null;
}

/**
 * @param {object | null | undefined} user
 * @param {string} pathname
 */
export function canAccessRoute(user, pathname) {
  const req = resolveRoutePermission(pathname);
  if (!req) return true;
  const menuKey = resolveMenuPermission(pathname);
  return (
    hasPermission(user, req.module, req.action || ACTIONS.VIEW) &&
    (!menuKey || hasPermission(user, menuKey, ACTIONS.VIEW))
  );
}

/**
 * @param {object | null | undefined} user
 * @param {string} moduleName
 */
export function canViewModule(user, moduleName) {
  return hasPermission(user, moduleName, ACTIONS.VIEW);
}

export function canViewMenu(user, menuKey, moduleName) {
  return canViewModule(user, moduleName) && hasPermission(user, menuKey, ACTIONS.VIEW);
}

export const MASTER_TAB_MENU_KEYS = {
  users: 'menu.master_users',
  categories: 'menu.master_categories',
  accessory: 'menu.master_accessory',
  sizes: 'menu.master_sizes',
  colors: 'menu.master_colors',
  'time-slots': 'menu.master_time_slots',
  'laundry-priority': 'menu.master_laundry_priority',
  reminders: 'menu.master_reminders',
  accounts: 'menu.master_accounts',
  units: 'menu.master_units',
  'code-format': 'menu.master_code_format',
  'bill-numbering': 'menu.master_bill_numbering',
  'custom-order-fields': 'menu.master_custom_order_fields',
  tailors: 'menu.master_tailors',
  bill_templates: 'menu.master_bill_templates',
};

export const SETTINGS_TAB_MENU_KEYS = {
  shops: 'menu.settings_shops',
  permissions: 'menu.settings_permissions',
  devices: 'menu.settings_devices',
  'ip-whitelisting': 'menu.settings_ip_whitelist',
  'system-logs': 'menu.settings_system_logs',
  'app-settings': 'menu.settings_app',
  whatsapp: 'menu.settings_whatsapp',
};

/** Master sidebar tab → permission module */
export const MASTER_TAB_MODULES = {
  users: MODULES.USERS,
  categories: MODULES.CATEGORIES,
  accessory: MODULES.ACCESSORIES,
  sizes: MODULES.SETTINGS,
  colors: MODULES.SETTINGS,
  'time-slots': MODULES.SETTINGS,
  'laundry-priority': MODULES.SETTINGS,
  reminders: MODULES.SETTINGS,
  accounts: MODULES.ACCOUNTS,
  units: MODULES.SETTINGS,
  'code-format': MODULES.SETTINGS,
  'bill-numbering': MODULES.SETTINGS,
  'custom-order-fields': MODULES.CUSTOM_ORDERS,
  tailors: MODULES.SETTINGS,
  bill_templates: MODULES.BILL_TEMPLATES,
};

/** Settings sidebar tab → permission module */
export const SETTINGS_TAB_MODULES = {
  shops: MODULES.SHOPS,
  permissions: MODULES.SETTINGS,
  devices: MODULES.SETTINGS,
  'system-logs': MODULES.AUDIT_LOGS,
  'app-settings': MODULES.SETTINGS,
  whatsapp: MODULES.SETTINGS,
  'ip-whitelisting': MODULES.SETTINGS,
};
