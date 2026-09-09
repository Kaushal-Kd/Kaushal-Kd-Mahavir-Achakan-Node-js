const REMOVED_KEY = 'DASHBOARD_PREPARE_DELIVERY_LEAD_DAYS';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex('settings').where({ key: REMOVED_KEY }).del();
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Setting rows are not restored on rollback.
}
