/**
 * Pricing and payment intent fields for custom orders (booking parity).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('custom_orders', (t) => {
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.decimal('line_discount', 12, 2).notNullable().defaultTo(0);
    t.enu('order_type', ['rent', 'sell']).notNullable().defaultTo('rent');
    t.enu('tax_mode', ['exclusive', 'inclusive']).notNullable().defaultTo('exclusive');
    t.boolean('gst_enabled').notNullable().defaultTo(true);
    t.boolean('igst_bill').notNullable().defaultTo(false);
    t.enu('booking_discount_type', ['flat', 'percent']).notNullable().defaultTo('flat');
    t.decimal('booking_discount_value', 12, 2).notNullable().defaultTo(0);
    t.decimal('booking_discount_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('subtotal', 12, 2).notNullable().defaultTo(0);
    t.decimal('discount_total', 12, 2).notNullable().defaultTo(0);
    t.decimal('tax_total', 12, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('advance_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('deposit_amount', 12, 2).notNullable().defaultTo(0);
    t.boolean('paid_security_amt').notNullable().defaultTo(false);
    t.string('advance_account_id', 80).nullable();
    t.string('security_account_id', 80).nullable();
    t.decimal('apply_credit_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('paid_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('balance', 12, 2).notNullable().defaultTo(0);
    t.enu('payment_status', ['pending', 'partial', 'paid', 'overpaid', 'refunded'])
      .notNullable()
      .defaultTo('pending');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('custom_orders', (t) => {
    t.dropColumn('price');
    t.dropColumn('line_discount');
    t.dropColumn('order_type');
    t.dropColumn('tax_mode');
    t.dropColumn('gst_enabled');
    t.dropColumn('igst_bill');
    t.dropColumn('booking_discount_type');
    t.dropColumn('booking_discount_value');
    t.dropColumn('booking_discount_amount');
    t.dropColumn('subtotal');
    t.dropColumn('discount_total');
    t.dropColumn('tax_total');
    t.dropColumn('total_amount');
    t.dropColumn('advance_amount');
    t.dropColumn('deposit_amount');
    t.dropColumn('paid_security_amt');
    t.dropColumn('advance_account_id');
    t.dropColumn('security_account_id');
    t.dropColumn('apply_credit_amount');
    t.dropColumn('paid_amount');
    t.dropColumn('balance');
    t.dropColumn('payment_status');
  });
}
