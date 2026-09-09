/**
 * Custom orders: first trial date/time + unlimited re-trials JSON.
 * Migrates legacy re_trial_* columns then drops them.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const hasTrialDate = await knex.schema.hasColumn('custom_orders', 'trial_date');
  if (!hasTrialDate) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.date('trial_date').nullable();
      t.string('trial_time', 16).nullable();
      t.json('retrials').nullable();
    });
  }

  const hasReTrial = await knex.schema.hasColumn('custom_orders', 're_trial_for_customer');
  if (hasReTrial) {
    const rows = await knex('custom_orders').select(
      'id',
      're_trial_for_customer',
      're_trial_date',
      're_trial_time'
    );

    for (const r of rows) {
      if (!r.re_trial_for_customer || !r.re_trial_date) continue;
      const entry = {
        date: r.re_trial_date,
        time: r.re_trial_time || null,
        notes: null,
      };
      await knex('custom_orders')
        .where({ id: r.id })
        .update({ retrials: JSON.stringify([entry]), updated_at: knex.fn.now() });
    }

    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('re_trial_for_customer');
      t.dropColumn('re_trial_date');
      t.dropColumn('re_trial_time');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasReTrial = await knex.schema.hasColumn('custom_orders', 're_trial_for_customer');
  if (!hasReTrial) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.boolean('re_trial_for_customer').notNullable().defaultTo(false);
      t.date('re_trial_date').nullable();
      t.string('re_trial_time', 16).nullable();
    });

    const rows = await knex('custom_orders').select('id', 'retrials');
    for (const r of rows) {
      let arr = r.retrials;
      if (typeof arr === 'string') {
        try {
          arr = JSON.parse(arr);
        } catch {
          arr = [];
        }
      }
      const first = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
      if (!first?.date) continue;
      await knex('custom_orders')
        .where({ id: r.id })
        .update({
          re_trial_for_customer: true,
          re_trial_date: first.date,
          re_trial_time: first.time || null,
        });
    }
  }

  const hasTrialDate = await knex.schema.hasColumn('custom_orders', 'trial_date');
  if (hasTrialDate) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('trial_date');
      t.dropColumn('trial_time');
      t.dropColumn('retrials');
    });
  }
}
