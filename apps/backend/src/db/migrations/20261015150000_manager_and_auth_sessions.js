const MANAGER_MODULES = [
  'dashboard', 'customers', 'products', 'accessories', 'categories', 'availability',
  'booking', 'delivery', 'return', 'custom_orders', 'laundry', 'inventory', 'sales',
  'purchases', 'payments', 'expenses', 'accounts', 'income', 'vouchers', 'credit_notes',
  'security', 'reports', 'bill_templates',
];
const MANAGER_ACTIONS = [
  'view', 'create', 'edit', 'export', 'print', 'approve', 'override_gap', 'apply_discount',
];

function managerPermissions() {
  return Object.fromEntries(
    MANAGER_MODULES.map((moduleName) => [
      moduleName,
      Object.fromEntries(MANAGER_ACTIONS.map((action) => [action, true])),
    ])
  );
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (!(await knex.schema.hasTable('auth_sessions'))) {
    await knex.schema.createTable('auth_sessions', (t) => {
      t.uuid('id').primary();
      t.uuid('user_id').notNullable().index();
      t.string('device_id', 128).notNullable();
      t.string('device_name', 200).nullable();
      t.string('ip', 64).nullable();
      t.timestamp('login_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('last_used_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('expires_at').notNullable();
      t.string('status', 20).notNullable().defaultTo('active');
      t.timestamp('revoked_at').nullable();
      t.uuid('revoked_by_user_id').nullable().index();
      t.string('revoke_reason', 500).nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id', 'device_id', 'status'], 'idx_auth_session_device_status');
      t.foreign('user_id').references('users.id').onDelete('CASCADE');
      t.foreign('revoked_by_user_id').references('users.id').onDelete('SET NULL');
    });
  }
  if (!(await knex.schema.hasColumn('refresh_tokens', 'session_id'))) {
    await knex.schema.alterTable('refresh_tokens', (t) => {
      t.uuid('session_id').nullable().index();
      t.foreign('session_id').references('auth_sessions.id').onDelete('CASCADE');
    });
  }

  const exists = await knex('role_permissions').where({ role: 'manager' }).first();
  if (!exists) {
    await knex('role_permissions').insert({
      role: 'manager',
      permissions: JSON.stringify(managerPermissions()),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('role_permissions').where({ role: 'manager' }).del();
  if (await knex.schema.hasColumn('refresh_tokens', 'session_id')) {
    await knex.schema.alterTable('refresh_tokens', (t) => {
      t.dropForeign('session_id');
      t.dropColumn('session_id');
    });
  }
  await knex.schema.dropTableIfExists('auth_sessions');
}
