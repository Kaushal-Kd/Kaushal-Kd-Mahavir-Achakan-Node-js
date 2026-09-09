/**
 * Orders + order_items + order_accessories + logs (requirements §15, §50, §53).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('customer_id').notNullable().index();

    t.string('order_number', 40).notNullable();
    t.integer('bill_no').notNullable();

    t.enu('order_type', ['rent', 'sell', 'mixed', 'trial', 'accessory_only'])
      .notNullable()
      .defaultTo('rent');

    t.json('event_type').nullable();
    t.date('wedding_date').nullable();
    t.date('trial_date').nullable();
    t.date('booking_date').notNullable();
    t.date('pickup_date').notNullable();
    t.date('return_date').nullable();

    t.uuid('sales_person_id').nullable().index();

    t.string('reference_name', 200).nullable();
    t.text('reference_note').nullable();
    t.boolean('has_reference').notNullable().defaultTo(false);

    t.string('pickup_name', 200).nullable();
    t.string('pickup_number', 30).nullable();
    t.string('received_by_name', 200).nullable();
    t.string('received_by_phone', 30).nullable();

    t.text('customer_notes').nullable();
    t.text('internal_notes').nullable();
    t.text('vip_notes').nullable();

    t.decimal('subtotal', 12, 2).notNullable().defaultTo(0);
    t.decimal('discount_total', 12, 2).notNullable().defaultTo(0);
    t.decimal('tax_total', 12, 2).notNullable().defaultTo(0);
    t.decimal('extra_charges', 12, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 12, 2).notNullable().defaultTo(0);

    t.decimal('deposit_amount', 12, 2).notNullable().defaultTo(0);
    t.boolean('deposit_received').notNullable().defaultTo(false);
    t.boolean('deposit_returned').notNullable().defaultTo(false);
    t.enu('deposit_payment_type', ['cash', 'card', 'upi', 'transfer', 'wallet', 'cheque', 'other'])
      .nullable();
    t.string('deposit_transaction_id', 100).nullable();
    t.text('deposit_notes').nullable();

    t.decimal('paid_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('balance', 12, 2).notNullable().defaultTo(0);

    t.enu('payment_status', ['pending', 'partial', 'paid', 'overpaid', 'refunded'])
      .notNullable()
      .defaultTo('pending');

    t.enu('status', [
      'draft',
      'pending',
      'confirmed',
      'in_preparation',
      'ready_for_delivery',
      'delivered',
      'partially_returned',
      'returned',
      'closed',
      'cancelled',
    ])
      .notNullable()
      .defaultTo('pending');

    t.text('cancel_reason').nullable();
    t.timestamp('canceled_at').nullable();
    t.timestamp('packed_at').nullable();
    t.timestamp('delivered_at').nullable();
    t.timestamp('returned_at').nullable();

    t.integer('next_booking_gap_days').notNullable().defaultTo(0);

    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.timestamp('deleted_at').nullable();

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['shop_id', 'order_number']);
    t.unique(['shop_id', 'bill_no']);
    t.index(['shop_id', 'status']);
    t.index(['shop_id', 'pickup_date']);
    t.index(['shop_id', 'return_date']);
    t.index(['shop_id', 'wedding_date']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('customer_id').references('customers.id');
  });

  await knex.schema.createTable('order_items', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('product_id').nullable().index();

    t.string('name_snapshot', 200).notNullable();
    t.string('code_snapshot', 80).nullable();

    t.integer('qty').notNullable().defaultTo(1);
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.decimal('discount', 12, 2).notNullable().defaultTo(0);
    t.decimal('tax', 12, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 12, 2).notNullable().defaultTo(0);

    t.enu('type', ['rent', 'sell']).notNullable().defaultTo('rent');
    t.enu('condition', ['fresh', 'reuse']).notNullable().defaultTo('fresh');

    t.decimal('length_inch', 6, 2).nullable();
    t.decimal('sleeves_inch', 6, 2).nullable();

    t.string('wearer_name', 200).nullable();
    t.string('wearer_role', 40).nullable();
    t.uuid('sub_profile_id').nullable();

    t.text('tailor_notes').nullable();
    t.text('customer_notes').nullable();
    t.text('delivery_notes').nullable();

    t.json('stage_flags').nullable();

    t.boolean('damaged').notNullable().defaultTo(false);
    t.boolean('missing').notNullable().defaultTo(false);
    t.decimal('damage_charge', 12, 2).notNullable().defaultTo(0);
    t.boolean('send_to_laundry').notNullable().defaultTo(false);

    t.timestamp('prepared_at').nullable();
    t.timestamp('delivered_at').nullable();
    t.timestamp('received_at').nullable();

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('order_id').references('orders.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('product_id').references('products.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('order_accessories', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('order_item_id').nullable().index();
    t.uuid('accessory_id').nullable().index();

    t.string('name_snapshot', 200).notNullable();
    t.string('code_snapshot', 80).nullable();

    t.integer('qty').notNullable().defaultTo(1);
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.decimal('discount', 12, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 12, 2).notNullable().defaultTo(0);

    t.enu('type', ['rent', 'sell']).notNullable().defaultTo('sell');
    t.enu('given_status', ['given_with_rent', 'pack_with_rent', 'regular'])
      .notNullable()
      .defaultTo('regular');

    t.json('stage_flags').nullable();

    t.boolean('damaged').notNullable().defaultTo(false);
    t.boolean('missing').notNullable().defaultTo(false);
    t.decimal('damage_charge', 12, 2).notNullable().defaultTo(0);

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('order_id').references('orders.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('order_item_id').references('order_items.id').onDelete('SET NULL');
    t.foreign('accessory_id').references('accessories.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('order_edit_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').nullable();
    t.string('order_number', 40).nullable();
    t.json('changes').nullable();
    t.string('change_summary', 500).nullable();
    t.timestamp('changed_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('order_id').references('orders.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('order_status_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('order_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').nullable();
    t.string('item_id', 60).nullable();
    t.enu('item_type', ['item', 'accessory', 'order']).notNullable().defaultTo('order');
    t.string('field', 40).nullable();
    t.string('action', 40).notNullable();
    t.string('old_value', 120).nullable();
    t.string('new_value', 120).nullable();
    t.string('message', 500).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('order_id').references('orders.id').onDelete('CASCADE');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('order_status_logs');
  await knex.schema.dropTableIfExists('order_edit_logs');
  await knex.schema.dropTableIfExists('order_accessories');
  await knex.schema.dropTableIfExists('order_items');
  await knex.schema.dropTableIfExists('orders');
}
