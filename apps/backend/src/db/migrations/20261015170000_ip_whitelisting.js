/**
 * Installation-wide IP access policy and per-user overrides.
 *
 * Existing users inherit a disabled global policy, so deploying this migration
 * cannot lock anyone out. Super-admin bypass is enforced in application code.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.createTable('ip_whitelist_config', (t) => {
    t.tinyint('id').unsigned().primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.json('allowed_ranges').nullable();
    t.uuid('updated_by_user_id').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('updated_by_user_id').references('users.id').onDelete('SET NULL');
  });

  await knex('ip_whitelist_config').insert({
    id: 1,
    enabled: false,
    allowed_ranges: JSON.stringify([]),
  });

  await knex.schema.createTable('user_ip_whitelist_policies', (t) => {
    t.uuid('user_id').primary();
    t.string('mode', 20).notNullable().defaultTo('inherit');
    t.json('allowed_ranges').nullable();
    t.uuid('updated_by_user_id').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
    t.foreign('updated_by_user_id').references('users.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('user_ip_whitelist_policies');
  await knex.schema.dropTableIfExists('ip_whitelist_config');
}
