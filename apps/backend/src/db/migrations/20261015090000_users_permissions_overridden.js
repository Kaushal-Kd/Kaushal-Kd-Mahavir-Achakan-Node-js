/**
 * Marks users whose permission grid was edited directly, rather than inherited
 * from their role.
 *
 * Without this, `syncUserPermissionsForRole()` (modules/roles/service.js) runs a
 * blanket `UPDATE users SET permissions` across every user of a role each time
 * the role matrix is saved — silently destroying any per-user customisation.
 * Rows flagged here are excluded from that sync.
 *
 * Defaults to false: every existing user currently holds a role snapshot, so
 * none of them are overridden yet.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('permissions_overridden').notNullable().defaultTo(false);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('permissions_overridden');
  });
}
