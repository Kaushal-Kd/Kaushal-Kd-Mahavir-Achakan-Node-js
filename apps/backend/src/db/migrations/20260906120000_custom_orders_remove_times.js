/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const rows = await knex('custom_orders').select('id', 'retrials');
  for (const row of rows) {
    let arr = row.retrials;
    if (arr == null) continue;
    if (typeof arr === 'string') {
      try {
        arr = JSON.parse(arr);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const cleaned = arr
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        date: r.date || null,
        notes: r.notes != null && String(r.notes).trim() ? String(r.notes).trim() : null,
      }));
    await knex('custom_orders')
      .where({ id: row.id })
      .update({ retrials: JSON.stringify(cleaned), updated_at: knex.fn.now() });
  }

  const hasTailorTime = await knex.schema.hasColumn('custom_orders', 'tailor_time');
  if (hasTailorTime) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('tailor_time');
    });
  }

  const hasTrialTime = await knex.schema.hasColumn('custom_orders', 'trial_time');
  if (hasTrialTime) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('trial_time');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTailorTime = await knex.schema.hasColumn('custom_orders', 'tailor_time');
  if (!hasTailorTime) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.string('tailor_time', 16).nullable();
    });
  }

  const hasTrialTime = await knex.schema.hasColumn('custom_orders', 'trial_time');
  if (!hasTrialTime) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.string('trial_time', 16).nullable();
    });
  }
}
