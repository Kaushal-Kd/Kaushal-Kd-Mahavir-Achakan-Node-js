const EDITABLE_ROLES = ['manager', 'salesman', 'accountant', 'viewer'];

/** @param {unknown} value */
function parsePermissions(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function normalizeLoginPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'login_phone'))) {
    await knex.schema.alterTable('users', (t) => {
      t.string('login_phone', 10).nullable().unique();
    });
  }
  await knex.schema.alterTable('users', (t) => {
    t.string('email', 255).nullable().alter();
  });

  if (!(await knex.schema.hasColumn('users_shops', 'permissions_overridden'))) {
    await knex.schema.alterTable('users_shops', (t) => {
      t.boolean('permissions_overridden').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasTable('shop_role_permissions'))) {
    await knex.schema.createTable('shop_role_permissions', (t) => {
      t.uuid('shop_id').notNullable();
      t.string('role', 40).notNullable();
      t.json('permissions').notNullable();
      t.uuid('updated_by_user_id').nullable().index();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.primary(['shop_id', 'role']);
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.foreign('updated_by_user_id').references('users.id').onDelete('SET NULL');
    });
  }

  if (!(await knex.schema.hasTable('password_otp_challenges'))) {
    await knex.schema.createTable('password_otp_challenges', (t) => {
      t.uuid('id').primary();
      t.uuid('target_user_id').notNullable().index();
      t.uuid('requested_by_user_id').notNullable().index();
      t.string('purpose', 40).notNullable().defaultTo('admin_password_change');
      t.string('otp_hash', 64).notNullable();
      t.timestamp('expires_at').notNullable().index();
      t.integer('attempts').unsigned().notNullable().defaultTo(0);
      t.timestamp('consumed_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.foreign('target_user_id').references('users.id').onDelete('CASCADE');
      t.foreign('requested_by_user_id').references('users.id').onDelete('CASCADE');
    });
  }

  if (!(await knex.schema.hasTable('system_settings'))) {
    await knex.schema.createTable('system_settings', (t) => {
      t.string('setting_key', 100).primary();
      t.text('setting_value').nullable();
      t.uuid('updated_by_user_id').nullable().index();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.foreign('updated_by_user_id').references('users.id').onDelete('SET NULL');
    });
  }

  await knex('system_settings')
    .insert({ setting_key: 'auth.login_mode', setting_value: 'dual_transition' })
    .onConflict('setting_key')
    .ignore();

  const phones = await knex('users').select('id', 'phone');
  const counts = new Map();
  for (const row of phones) {
    const phone = normalizeLoginPhone(row.phone);
    if (phone) counts.set(phone, (counts.get(phone) || 0) + 1);
  }
  for (const row of phones) {
    const phone = normalizeLoginPhone(row.phone);
    if (phone && counts.get(phone) === 1) {
      await knex('users').where({ id: row.id }).update({ login_phone: phone });
    }
  }

  const globalRoles = await knex('role_permissions').select('role', 'permissions');
  const globalByRole = new Map(globalRoles.map((row) => [row.role, row.permissions]));
  const shops = await knex('shops').select('id');
  for (const shop of shops) {
    for (const role of EDITABLE_ROLES) {
      const permissions = globalByRole.get(role);
      if (permissions) {
        await knex('shop_role_permissions')
          .insert({ shop_id: shop.id, role, permissions })
          .onConflict(['shop_id', 'role'])
          .ignore();
      }
    }
  }

  const memberships = await knex('users_shops as us')
    .join('users as u', 'u.id', 'us.user_id')
    .select('us.user_id', 'us.shop_id', 'u.permissions', 'u.permissions_overridden');
  for (const row of memberships) {
    const permissions = parsePermissions(row.permissions);
    await knex('users_shops')
      .where({ user_id: row.user_id, shop_id: row.shop_id })
      .update({
        permissions: permissions ? JSON.stringify(permissions) : null,
        permissions_overridden: Boolean(row.permissions_overridden),
      });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('password_otp_challenges');
  await knex.schema.dropTableIfExists('shop_role_permissions');
  await knex.schema.dropTableIfExists('system_settings');
  if (await knex.schema.hasColumn('users_shops', 'permissions_overridden')) {
    await knex.schema.alterTable('users_shops', (t) => t.dropColumn('permissions_overridden'));
  }
  if (await knex.schema.hasColumn('users', 'login_phone')) {
    await knex.schema.alterTable('users', (t) => t.dropColumn('login_phone'));
  }
  await knex('users')
    .whereNull('email')
    .update({ email: knex.raw("CONCAT(id, '@rollback.invalid')") });
  await knex.schema.alterTable('users', (t) => {
    t.string('email', 255).notNullable().alter();
  });
}
