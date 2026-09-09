/**
 * role_permissions — persisted overrides for the default role/permission
 * matrix (requirements §49). One row per role. If a row is missing for a
 * given role, the code-level defaults from
 * `defaultPermissionsByRole()` (@wrs/shared) are used instead.
 *
 * Manipulated from Settings → Roles & Permissions (super_admin only).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('role_permissions', (t) => {
    t.string('role', 40).primary();
    t.json('permissions').notNullable();
    t.uuid('updated_by_user_id').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('role_permissions');
}
