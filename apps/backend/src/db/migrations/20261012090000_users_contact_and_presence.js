/**
 * Adds optional contact detail to users plus a presence timestamp.
 *
 * - phone2 / address / remark: all nullable. Only `phone` was available before
 *   and shops needed a second number and free-text notes per user.
 * - last_seen_at: stamped (throttled) by the auth preHandler so the users list
 *   can show an online/offline dot. Indexed because the list derives
 *   `is_online` from it on every fetch.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('phone2', 30).nullable();
    t.text('address').nullable();
    t.text('remark').nullable();
    t.timestamp('last_seen_at').nullable().index();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('phone2');
    t.dropColumn('address');
    t.dropColumn('remark');
    t.dropColumn('last_seen_at');
  });
}
