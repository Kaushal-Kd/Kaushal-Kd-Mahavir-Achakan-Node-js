/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('custom_order_field_definitions', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('field_key', 64).notNullable();
    t.string('label', 120).notNullable();
    t.string('field_type', 16).notNullable().defaultTo('number');
    t.string('unit', 32).nullable();
    t.boolean('required').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['shop_id', 'field_key']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('custom_orders', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('order_number', 40).notNullable();
    t.string('status', 32).notNullable().defaultTo('draft');
    t.string('customer_name', 200).notNullable();
    t.string('customer_phone', 20).nullable();
    t.text('customer_address').nullable();
    t.date('marriage_date').nullable();
    t.date('order_date').nullable();
    t.string('design_name', 200).nullable();
    t.text('remarks').nullable();
    t.boolean('given_to_tailor').notNullable().defaultTo(false);
    t.date('tailor_date').nullable();
    t.string('tailor_time', 16).nullable();
    t.boolean('re_trial_for_customer').notNullable().defaultTo(false);
    t.date('re_trial_date').nullable();
    t.string('re_trial_time', 16).nullable();
    t.json('measurements').nullable();
    t.json('design_images').nullable();
    t.json('trial_images').nullable();
    t.uuid('linked_order_id').nullable();
    t.uuid('created_by').nullable();
    t.uuid('updated_by').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['shop_id', 'order_number']);
    t.index(['shop_id', 'status']);
    t.index(['shop_id', 'order_date']);
    t.index(['shop_id', 'marriage_date']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('custom_orders');
  await knex.schema.dropTableIfExists('custom_order_field_definitions');
}
