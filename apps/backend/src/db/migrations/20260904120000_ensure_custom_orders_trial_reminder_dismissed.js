/**
 * Repair: ensure trial reminder dismiss columns exist (idempotent).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasDate = await knex.schema.hasColumn('custom_orders', 'trial_reminder_dismissed_date');
  if (!hasDate) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.date('trial_reminder_dismissed_date').nullable();
      t.string('trial_reminder_dismissed_kind', 16).nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasDate = await knex.schema.hasColumn('custom_orders', 'trial_reminder_dismissed_date');
  if (hasDate) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('trial_reminder_dismissed_date');
      t.dropColumn('trial_reminder_dismissed_kind');
    });
  }
}
