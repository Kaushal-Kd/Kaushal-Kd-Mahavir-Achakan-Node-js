/**
 * Master area: single nav list and URL segments under `/master/:tab`.
 * Order matches the product sidebar.
 */
export const MASTER_DEFAULT_TAB = 'users';

/** @typedef {{ id: string, label: string, kind: string, configId?: string }} MasterNavItem */

/** @type {MasterNavItem[]} */
export const MASTER_NAV_ITEMS = [
  { id: 'users', label: 'Users', kind: 'users' },
  { id: 'categories', label: 'Categories', kind: 'config', configId: 'categories' },
  { id: 'accessory', label: 'Accessory', kind: 'accessory' },
  { id: 'sizes', label: 'Size', kind: 'config', configId: 'sizes' },
  { id: 'colors', label: 'Colors', kind: 'config', configId: 'colors' },
  { id: 'time-slots', label: 'Time Slots', kind: 'config', configId: 'time-slots' },
  { id: 'laundry-priority', label: 'Laundry priority', kind: 'config', configId: 'laundry-priority' },
  { id: 'reminders', label: 'Reminder', kind: 'reminders' },
  { id: 'accounts', label: 'Accounts', kind: 'accounts' },
  { id: 'units', label: 'Units', kind: 'config', configId: 'units' },
  { id: 'code-format', label: 'Code format', kind: 'config', configId: 'code-format' },
  { id: 'bill-numbering', label: 'Bill numbering', kind: 'config', configId: 'bill-numbering' },
  {
    id: 'custom-order-fields',
    label: 'Custom order measurements',
    kind: 'config',
    configId: 'custom-order-fields',
  },
  { id: 'tailors', label: 'Tailors', kind: 'config', configId: 'tailors' },
  { id: 'bill_templates', label: 'Bill Templates', kind: 'bill_templates' },
];

export const MASTER_TAB_IDS = new Set(MASTER_NAV_ITEMS.map((it) => it.id));
