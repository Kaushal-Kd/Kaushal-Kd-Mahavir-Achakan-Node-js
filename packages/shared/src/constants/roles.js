/**
 * System roles. Stored as strings in `users.role`.
 * Permission matrix per role lives in `permissions.js`.
 */
export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  SHOP_ADMIN: 'shop_admin',
  MANAGER: 'manager',
  SALESMAN: 'salesman',
  ACCOUNTANT: 'accountant',
  VIEWER: 'viewer',
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.SHOP_ADMIN]: 'Shop Admin',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.SALESMAN]: 'Salesman',
  [ROLES.ACCOUNTANT]: 'Accountant',
  [ROLES.VIEWER]: 'Viewer',
});

/** Roles removed from the product — migrated to salesman in DB. */
export const REMOVED_ROLES = Object.freeze([
  'branch_admin',
  'cashier',
  'tailor',
  'laundry_staff',
  'delivery_staff',
]);

export const ALL_ROLES = Object.values(ROLES);
