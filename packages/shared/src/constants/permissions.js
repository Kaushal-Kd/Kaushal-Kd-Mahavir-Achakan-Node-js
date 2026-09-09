/**
 * Permission matrix. Every module supports granular actions.
 * Permissions are stored per-user as JSON: { module: { action: boolean } }.
 */

export const MODULES = Object.freeze({
  DASHBOARD: 'dashboard',
  SHOPS: 'shops',
  USERS: 'users',
  CUSTOMERS: 'customers',
  PRODUCTS: 'products',
  ACCESSORIES: 'accessories',
  CATEGORIES: 'categories',
  AVAILABILITY: 'availability',
  BOOKING: 'booking',
  DELIVERY: 'delivery',
  RETURN: 'return',
  CUSTOM_ORDERS: 'custom_orders',
  LAUNDRY: 'laundry',
  INVENTORY: 'inventory',
  SALES: 'sales',
  PURCHASES: 'purchases',
  PAYMENTS: 'payments',
  EXPENSES: 'expenses',
  ACCOUNTS: 'accounts',
  INCOME: 'income',
  VOUCHERS: 'vouchers',
  CREDIT_NOTES: 'credit_notes',
  SECURITY: 'security',
  REPORTS: 'reports',
  BULK_IMPORT: 'bulk_import',
  SETTINGS: 'settings',
  BILL_TEMPLATES: 'bill_templates',
  AUDIT_LOGS: 'audit_logs',
});

export const MODULE_LABELS = Object.freeze({
  [MODULES.DASHBOARD]: 'Dashboard',
  [MODULES.SHOPS]: 'Shops',
  [MODULES.USERS]: 'Users',
  [MODULES.CUSTOMERS]: 'Customers',
  [MODULES.PRODUCTS]: 'Products',
  [MODULES.ACCESSORIES]: 'Accessories',
  [MODULES.CATEGORIES]: 'Categories',
  [MODULES.AVAILABILITY]: 'Availability',
  [MODULES.BOOKING]: 'Booking',
  [MODULES.DELIVERY]: 'Delivery',
  [MODULES.RETURN]: 'Return',
  [MODULES.CUSTOM_ORDERS]: 'Custom orders',
  [MODULES.LAUNDRY]: 'Laundry / washing',
  [MODULES.INVENTORY]: 'Inventory',
  [MODULES.SALES]: 'Sales',
  [MODULES.PURCHASES]: 'Purchases',
  [MODULES.PAYMENTS]: 'Payments',
  [MODULES.EXPENSES]: 'Expenses',
  [MODULES.ACCOUNTS]: 'Accounts',
  [MODULES.INCOME]: 'Income',
  [MODULES.VOUCHERS]: 'Vouchers',
  [MODULES.CREDIT_NOTES]: 'Credit notes',
  [MODULES.SECURITY]: 'Security',
  [MODULES.REPORTS]: 'Reports',
  [MODULES.BULK_IMPORT]: 'Bulk import',
  [MODULES.SETTINGS]: 'Settings',
  [MODULES.BILL_TEMPLATES]: 'Bill templates',
  [MODULES.AUDIT_LOGS]: 'Audit logs',
});

export const ACTIONS = Object.freeze({
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  EXPORT: 'export',
  PRINT: 'print',
  APPROVE: 'approve',
  CANCEL: 'cancel',
  REFUND: 'refund',
  OVERRIDE_GAP: 'override_gap',
  APPLY_DISCOUNT: 'apply_discount',
});

export const ALL_ACTIONS = Object.values(ACTIONS);
export const ALL_MODULES = Object.values(MODULES);

/**
 * Leaf-level sidebar entries. These keys control menu visibility and direct
 * navigation while their parent module continues to protect backend actions.
 */
export const MENU_PERMISSION_TARGETS = Object.freeze([
  { key: 'menu.dashboard', label: 'Dashboard / Dashboard', parent: MODULES.DASHBOARD },
  { key: 'menu.check_availability', label: 'Dashboard / Check Availability', parent: MODULES.AVAILABILITY },
  { key: 'menu.products_available', label: 'Dashboard / Products Available', parent: MODULES.AVAILABILITY },
  { key: 'menu.inventory', label: 'Inventory / Inventory', parent: MODULES.INVENTORY },
  { key: 'menu.products_catalogue', label: 'Inventory / Products Catalogue', parent: MODULES.INVENTORY },
  { key: 'menu.products', label: 'Inventory / Products', parent: MODULES.PRODUCTS },
  { key: 'menu.bulk_import', label: 'Inventory / Import Product/Accessories', parent: MODULES.BULK_IMPORT },
  { key: 'menu.item_to_collect', label: 'General Report / Item to Collect', parent: MODULES.DELIVERY },
  { key: 'menu.prepare_item', label: 'General Report / Prepare Item', parent: MODULES.BOOKING },
  { key: 'menu.delivery', label: 'General Report / Delivery', parent: MODULES.DELIVERY },
  { key: 'menu.return', label: 'General Report / Return', parent: MODULES.RETURN },
  { key: 'menu.booked_product', label: 'General Report / Booked Product', parent: MODULES.BOOKING },
  { key: 'menu.security_transaction', label: 'General Report / Security Transaction', parent: MODULES.SECURITY },
  { key: 'menu.due_security', label: 'General Report / Due Security', parent: MODULES.SECURITY },
  { key: 'menu.missing_damage_charges', label: 'General Report / Missing/Damage Charges', parent: MODULES.SECURITY },
  { key: 'menu.product_history', label: 'General Report / Product History', parent: MODULES.REPORTS },
  { key: 'menu.salesman_report', label: 'General Report / Salesman', parent: MODULES.REPORTS },
  { key: 'menu.customers', label: 'General Report / Customers', parent: MODULES.CUSTOMERS },
  { key: 'menu.bookings', label: 'Transaction / Bookings', parent: MODULES.BOOKING },
  { key: 'menu.sales', label: 'Transaction / Sale', parent: MODULES.SALES },
  { key: 'menu.custom_orders', label: 'Transaction / Custom Orders', parent: MODULES.CUSTOM_ORDERS },
  { key: 'menu.purchases', label: 'Transaction / Purchase', parent: MODULES.PURCHASES },
  { key: 'menu.income', label: 'Transaction / Income', parent: MODULES.INCOME },
  { key: 'menu.expense', label: 'Transaction / Expense', parent: MODULES.EXPENSES },
  { key: 'menu.washing', label: 'Transaction / Washing', parent: MODULES.LAUNDRY },
  { key: 'menu.journal_vouchers', label: 'Transaction / Journal Vouchers', parent: MODULES.VOUCHERS },
  { key: 'menu.payment_voucher', label: 'Transaction / Payment Voucher', parent: MODULES.VOUCHERS },
  { key: 'menu.receipt_voucher', label: 'Transaction / Receipt Voucher', parent: MODULES.VOUCHERS },
  { key: 'menu.credit_notes', label: 'Transaction / Credit Notes', parent: MODULES.CREDIT_NOTES },
  { key: 'menu.daily_cashbook', label: 'Finance Report / Daily Cashbook', parent: MODULES.REPORTS },
  { key: 'menu.product_performance', label: 'Finance Report / Product Performance', parent: MODULES.REPORTS },
  { key: 'menu.pending_bills', label: 'Finance Report / Pending Bills Amounts', parent: MODULES.REPORTS },
  { key: 'menu.income_expense', label: 'Finance Report / Income & Expenses', parent: MODULES.REPORTS },
  { key: 'menu.account_ledger', label: 'Finance Report / Account Ledger', parent: MODULES.REPORTS },
  { key: 'menu.trial_balance', label: 'Finance Report / Trial Balance', parent: MODULES.REPORTS },
  { key: 'menu.gst_report', label: 'Finance Report / GST Report', parent: MODULES.REPORTS },
  { key: 'menu.master_users', label: 'Master / Users', parent: MODULES.USERS },
  { key: 'menu.master_categories', label: 'Master / Categories', parent: MODULES.CATEGORIES },
  { key: 'menu.master_accessory', label: 'Master / Accessory', parent: MODULES.ACCESSORIES },
  { key: 'menu.master_sizes', label: 'Master / Size', parent: MODULES.SETTINGS },
  { key: 'menu.master_colors', label: 'Master / Colors', parent: MODULES.SETTINGS },
  { key: 'menu.master_time_slots', label: 'Master / Time Slots', parent: MODULES.SETTINGS },
  { key: 'menu.master_laundry_priority', label: 'Master / Laundry Priority', parent: MODULES.SETTINGS },
  { key: 'menu.master_reminders', label: 'Master / Reminder', parent: MODULES.SETTINGS },
  { key: 'menu.master_accounts', label: 'Master / Accounts', parent: MODULES.ACCOUNTS },
  { key: 'menu.master_units', label: 'Master / Units', parent: MODULES.SETTINGS },
  { key: 'menu.master_code_format', label: 'Master / Code Format', parent: MODULES.SETTINGS },
  { key: 'menu.master_bill_numbering', label: 'Master / Bill Numbering', parent: MODULES.SETTINGS },
  { key: 'menu.master_custom_order_fields', label: 'Master / Custom Order Measurements', parent: MODULES.CUSTOM_ORDERS },
  { key: 'menu.master_tailors', label: 'Master / Tailors', parent: MODULES.SETTINGS },
  { key: 'menu.master_bill_templates', label: 'Master / Bill Templates', parent: MODULES.BILL_TEMPLATES },
  { key: 'menu.settings_shops', label: 'Settings / Shops & Branches', parent: MODULES.SHOPS },
  { key: 'menu.settings_permissions', label: 'Settings / Roles & Permissions', parent: MODULES.SETTINGS },
  { key: 'menu.settings_devices', label: 'Settings / Login User Device', parent: MODULES.SETTINGS },
  { key: 'menu.settings_ip_whitelist', label: 'Settings / IP Whitelisting', parent: MODULES.SETTINGS },
  { key: 'menu.settings_system_logs', label: 'Settings / System Logs', parent: MODULES.AUDIT_LOGS },
  { key: 'menu.settings_app', label: 'Settings / App Settings', parent: MODULES.SETTINGS },
  { key: 'menu.settings_whatsapp', label: 'Settings / WhatsApp Messages', parent: MODULES.SETTINGS },
]);

export const MENU_PERMISSION_BY_KEY = Object.freeze(
  Object.fromEntries(MENU_PERMISSION_TARGETS.map((target) => [target.key, target]))
);
export const ALL_PERMISSION_MODULES = Object.freeze([
  ...ALL_MODULES,
  ...MENU_PERMISSION_TARGETS.map((target) => target.key),
]);

/**
 * Build a "full access" permissions object for the given modules.
 * @param {string[]} [modules=ALL_MODULES]
 * @returns {Record<string, Record<string, boolean>>}
 */
export function fullAccess(modules = ALL_PERMISSION_MODULES) {
  const out = {};
  for (const m of modules) {
    out[m] = {};
    for (const a of ALL_ACTIONS) out[m][a] = true;
  }
  return out;
}

/**
 * @param {string[]} modules
 * @param {string[]} actions
 */
function partialAccess(modules, actions) {
  const out = {};
  for (const m of modules) {
    out[m] = {};
    for (const a of actions) out[m][a] = true;
  }
  return out;
}

/**
 * Default permission templates per role.
 * @returns {Record<string, Record<string, Record<string, boolean>>>}
 */
export function defaultPermissionsByRole() {
  const readOnly = {};
  for (const m of ALL_MODULES) readOnly[m] = { [ACTIONS.VIEW]: true };

  const salesmanModules = [
    MODULES.DASHBOARD,
    MODULES.AVAILABILITY,
    MODULES.CUSTOMERS,
    MODULES.PRODUCTS,
    MODULES.ACCESSORIES,
    MODULES.BOOKING,
    MODULES.DELIVERY,
    MODULES.RETURN,
    MODULES.CUSTOM_ORDERS,
    MODULES.INVENTORY,
    MODULES.SALES,
    MODULES.LAUNDRY,
    MODULES.BULK_IMPORT,
    MODULES.REPORTS,
    MODULES.SECURITY,
  ];
  const salesmanActions = [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.EDIT,
    ACTIONS.PRINT,
    ACTIONS.EXPORT,
  ];

  const accountantModules = [
    MODULES.DASHBOARD,
    MODULES.PAYMENTS,
    MODULES.EXPENSES,
    MODULES.ACCOUNTS,
    MODULES.INCOME,
    MODULES.VOUCHERS,
    MODULES.CREDIT_NOTES,
    MODULES.REPORTS,
    MODULES.PURCHASES,
  ];

  const managerModules = [
    MODULES.DASHBOARD,
    MODULES.CUSTOMERS,
    MODULES.PRODUCTS,
    MODULES.ACCESSORIES,
    MODULES.CATEGORIES,
    MODULES.AVAILABILITY,
    MODULES.BOOKING,
    MODULES.DELIVERY,
    MODULES.RETURN,
    MODULES.CUSTOM_ORDERS,
    MODULES.LAUNDRY,
    MODULES.INVENTORY,
    MODULES.SALES,
    MODULES.PURCHASES,
    MODULES.PAYMENTS,
    MODULES.EXPENSES,
    MODULES.ACCOUNTS,
    MODULES.INCOME,
    MODULES.VOUCHERS,
    MODULES.CREDIT_NOTES,
    MODULES.SECURITY,
    MODULES.REPORTS,
    MODULES.BILL_TEMPLATES,
  ];
  const managerActions = [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.EDIT,
    ACTIONS.EXPORT,
    ACTIONS.PRINT,
    ACTIONS.APPROVE,
    ACTIONS.OVERRIDE_GAP,
    ACTIONS.APPLY_DISCOUNT,
  ];

  return {
    super_admin: fullAccess(),
    shop_admin: fullAccess(),
    manager: partialAccess(managerModules, managerActions),
    salesman: partialAccess(salesmanModules, salesmanActions),
    accountant: {
      ...partialAccess(accountantModules, [ACTIONS.VIEW, ACTIONS.EXPORT, ACTIONS.PRINT]),
      [MODULES.PAYMENTS]: {
        [ACTIONS.VIEW]: true,
        [ACTIONS.CREATE]: true,
        [ACTIONS.EDIT]: true,
        [ACTIONS.EXPORT]: true,
        [ACTIONS.REFUND]: true,
        [ACTIONS.PRINT]: true,
      },
      [MODULES.EXPENSES]: {
        [ACTIONS.VIEW]: true,
        [ACTIONS.CREATE]: true,
        [ACTIONS.EDIT]: true,
        [ACTIONS.EXPORT]: true,
      },
      [MODULES.INCOME]: {
        [ACTIONS.VIEW]: true,
        [ACTIONS.CREATE]: true,
        [ACTIONS.EDIT]: true,
        [ACTIONS.EXPORT]: true,
      },
      [MODULES.VOUCHERS]: {
        [ACTIONS.VIEW]: true,
        [ACTIONS.CREATE]: true,
        [ACTIONS.EDIT]: true,
        [ACTIONS.EXPORT]: true,
        [ACTIONS.PRINT]: true,
      },
      [MODULES.CREDIT_NOTES]: {
        [ACTIONS.VIEW]: true,
        [ACTIONS.CREATE]: true,
        [ACTIONS.EDIT]: true,
        [ACTIONS.EXPORT]: true,
      },
      [MODULES.PURCHASES]: {
        [ACTIONS.VIEW]: true,
        [ACTIONS.CREATE]: true,
        [ACTIONS.EDIT]: true,
        [ACTIONS.EXPORT]: true,
      },
    },
    viewer: readOnly,
  };
}

/**
 * @param {{ permissions?: object, role?: string }} user
 * @param {string} moduleName
 * @param {string} action
 * @returns {boolean}
 */
export function hasPermission(user, moduleName, action) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'shop_admin') return true;

  let perms = user.permissions;
  if (typeof perms === 'string') {
    try {
      perms = JSON.parse(perms);
      if (typeof perms === 'string') perms = JSON.parse(perms);
    } catch {
      return false;
    }
  }
  if (!perms || typeof perms !== 'object') return false;
  const target = MENU_PERMISSION_BY_KEY[moduleName];
  const modulePerms = perms[moduleName] || (target ? perms[target.parent] : null);
  if (!modulePerms) return false;
  return modulePerms[action] === true;
}
