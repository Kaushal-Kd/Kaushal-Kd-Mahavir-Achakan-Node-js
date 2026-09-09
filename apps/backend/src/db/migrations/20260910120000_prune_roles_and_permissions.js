const REMOVED_ROLES = [
  'branch_admin',
  'manager',
  'cashier',
  'tailor',
  'laundry_staff',
  'delivery_staff',
];

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex('users').whereIn('role', REMOVED_ROLES).update({ role: 'salesman' });
  await knex('role_permissions').whereIn('role', REMOVED_ROLES).del();
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Roles cannot be restored from users alone; no-op.
  void knex;
}
