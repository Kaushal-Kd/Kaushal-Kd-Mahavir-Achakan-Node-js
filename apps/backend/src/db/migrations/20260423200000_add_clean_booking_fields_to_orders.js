/**
 * Add first-class booking fields used by Create Booking UI flow.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.enu('payment_mode', ['cash', 'upi', 'card', 'bank']).nullable();
    t.enu('tax_mode', ['exclusive', 'inclusive']).notNullable().defaultTo('exclusive');
    t.boolean('gst_enabled').notNullable().defaultTo(true);
    t.boolean('igst_bill').notNullable().defaultTo(false);
    t.string('advance_account_id', 80).nullable();
    t.string('security_account_id', 80).nullable();
    t.boolean('paid_security_amt').notNullable().defaultTo(false);
    t.enu('booking_discount_type', ['flat', 'percent']).notNullable().defaultTo('flat');
    t.decimal('booking_discount_value', 12, 2).notNullable().defaultTo(0);
    t.decimal('booking_discount_amount', 12, 2).notNullable().defaultTo(0);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('payment_mode');
    t.dropColumn('tax_mode');
    t.dropColumn('gst_enabled');
    t.dropColumn('igst_bill');
    t.dropColumn('advance_account_id');
    t.dropColumn('security_account_id');
    t.dropColumn('paid_security_amt');
    t.dropColumn('booking_discount_type');
    t.dropColumn('booking_discount_value');
    t.dropColumn('booking_discount_amount');
  });
}
