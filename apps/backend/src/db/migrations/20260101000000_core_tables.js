/**
 * Core tables for the Wedding Rent System (requirements §10, §49, §62, §63).
 *
 * - shops           (multi-branch / multi-shop)
 * - users           (staff + admin)
 * - users_shops     (N:N mapping for shop access — requirements §49)
 * - categories      (per-shop)
 * - settings        (per-shop key-value)
 * - translations    (smart dictionary — requirements §58)
 * - audit_logs      (requirements §84)
 *
 * All tables use CHAR(36) UUID PKs (app-generated) for cross-device sync compatibility.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('shops', (t) => {
    t.uuid('id').primary();
    t.uuid('parent_shop_id').nullable().index();
    t.string('company_name', 200).notNullable();
    t.string('shop_name', 200).notNullable();
    t.string('owner_name', 200).nullable();
    t.string('gstin', 20).nullable();
    t.string('pan', 20).nullable();
    t.string('phone', 30).nullable();
    t.string('email', 200).nullable();
    t.text('address').nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('pincode', 20).nullable();
    t.string('logo_url', 500).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary();
    t.string('name', 200).notNullable();
    t.string('email', 200).notNullable().unique();
    t.string('phone', 30).nullable();
    t.string('username', 60).nullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('role', 40).notNullable().defaultTo('viewer');
    t.json('permissions').nullable();
    t.string('avatar_url', 500).nullable();
    t.uuid('primary_shop_id').nullable().index();
    t.uuid('last_selected_shop_id').nullable().index();
    t.boolean('must_change_password').notNullable().defaultTo(false);
    t.timestamp('password_changed_at').nullable();
    t.integer('failed_login_count').notNullable().defaultTo(0);
    t.timestamp('locked_until').nullable();
    t.timestamp('last_login_at').nullable();
    t.string('last_login_ip', 64).nullable();
    t.string('last_device_id', 128).nullable();
    t.string('last_device_name', 200).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('users_shops', (t) => {
    t.uuid('user_id').notNullable();
    t.uuid('shop_id').notNullable();
    t.json('permissions').nullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'shop_id']);
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable().index();
    t.string('token_hash', 255).notNullable().unique();
    t.string('device_id', 128).nullable();
    t.string('device_name', 200).nullable();
    t.string('ip', 64).nullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('categories', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('key', 80).notNullable();
    t.string('label', 120).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['shop_id', 'key']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('settings', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('key', 100).notNullable();
    t.text('value').nullable();
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['shop_id', 'key']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('translations', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').nullable().index();
    t.string('language', 10).notNullable().defaultTo('gu');
    t.string('english_word', 200).notNullable();
    t.string('translation', 400).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['shop_id', 'language', 'english_word']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').nullable().index();
    t.uuid('user_id').nullable().index();
    t.string('user_name', 200).nullable();
    t.string('action', 40).notNullable();
    t.string('entity', 60).notNullable();
    t.string('entity_id', 60).nullable().index();
    t.json('old_value').nullable();
    t.json('new_value').nullable();
    t.string('ip', 64).nullable();
    t.string('device', 200).nullable();
    t.string('user_agent', 400).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('translations');
  await knex.schema.dropTableIfExists('settings');
  await knex.schema.dropTableIfExists('categories');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users_shops');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('shops');
}
