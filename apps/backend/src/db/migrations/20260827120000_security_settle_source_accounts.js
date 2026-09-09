/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasScCol = await knex.schema.hasColumn('security_charges', 'security_account_id');
  if (!hasScCol) {
    await knex.schema.alterTable('security_charges', (t) => {
      t.string('security_account_id', 80).nullable().index();
    });
  }

  const hasIeCol = await knex.schema.hasColumn('income_entries', 'security_account_id');
  if (!hasIeCol) {
    await knex.schema.alterTable('income_entries', (t) => {
      t.string('security_account_id', 80).nullable().index();
    });
  }

  await knex.schema.alterTable('income_entries', (t) => {
    t.string('payment_account_id', 80).nullable().alter();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('income_entries').whereNull('payment_account_id').delete();

  await knex.schema.alterTable('income_entries', (t) => {
    t.string('payment_account_id', 80).notNullable().alter();
  });

  const hasIeCol = await knex.schema.hasColumn('income_entries', 'security_account_id');
  if (hasIeCol) {
    await knex.schema.alterTable('income_entries', (t) => {
      t.dropColumn('security_account_id');
    });
  }

  const hasScCol = await knex.schema.hasColumn('security_charges', 'security_account_id');
  if (hasScCol) {
    await knex.schema.alterTable('security_charges', (t) => {
      t.dropColumn('security_account_id');
    });
  }
}
