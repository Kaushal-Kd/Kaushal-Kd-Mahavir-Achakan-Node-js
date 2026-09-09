const COLUMNS = [
  'reference_note',
  'trial_date',
  'has_reference',
  'internal_notes',
  'vip_notes',
  'deposit_payment_type',
  'deposit_transaction_id',
  'deposit_notes',
];

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  for (const col of COLUMNS) {
    const has = await knex.schema.hasColumn('orders', col);
    if (has) {
      await knex.schema.alterTable('orders', (t) => {
        t.dropColumn(col);
      });
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.date('trial_date').nullable();
    t.text('reference_note').nullable();
    t.boolean('has_reference').notNullable().defaultTo(false);
    t.text('internal_notes').nullable();
    t.text('vip_notes').nullable();
    t.enu('deposit_payment_type', ['cash', 'card', 'upi', 'transfer', 'wallet', 'cheque', 'other']).nullable();
    t.string('deposit_transaction_id', 100).nullable();
    t.text('deposit_notes').nullable();
  });
}
