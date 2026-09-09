/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('laundry_jobs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('job_no', 40).notNullable();
    t.date('laundry_date').notNullable();
    t.string('vendor_name', 200).nullable();
    t.string('pickup_by', 120).nullable();
    t.text('remarks').nullable();
    t.decimal('product_total', 12, 2).notNullable().defaultTo(0);
    t.decimal('accessory_total', 12, 2).notNullable().defaultTo(0);
    t.decimal('subtotal', 12, 2).notNullable().defaultTo(0);
    t.enu('discount_mode', ['fixed', 'percent']).notNullable().defaultTo('fixed');
    t.decimal('discount_value', 12, 2).notNullable().defaultTo(0);
    t.decimal('discount_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('payable_amount', 12, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['shop_id', 'job_no']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('laundry_job_products', (t) => {
    t.uuid('id').primary();
    t.uuid('laundry_job_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('product_id').nullable().index();
    t.uuid('category_id').nullable().index();
    t.string('category_label', 120).nullable();
    t.string('product_code', 80).nullable();
    t.string('product_name', 200).notNullable();
    t.string('image_url', 500).nullable();
    t.date('next_pickup_date').nullable();
    t.integer('days_left').nullable();
    t.enu('priority', ['Urgent', 'High', 'Medium', 'Low', 'No Schedule']).notNullable().defaultTo('No Schedule');
    t.integer('qty').notNullable().defaultTo(1);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('laundry_job_id').references('laundry_jobs.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('product_id').references('products.id').onDelete('SET NULL');
    t.foreign('category_id').references('categories.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('laundry_job_accessories', (t) => {
    t.uuid('id').primary();
    t.uuid('laundry_job_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('accessory_id').nullable().index();
    t.string('accessory_code', 80).nullable();
    t.string('accessory_name', 200).notNullable();
    t.integer('qty').notNullable().defaultTo(1);
    t.decimal('rate', 12, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 12, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('laundry_job_id').references('laundry_jobs.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('accessory_id').references('accessories.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('laundry_job_category_prices', (t) => {
    t.uuid('id').primary();
    t.uuid('laundry_job_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('category_id').nullable().index();
    t.string('category_key', 80).notNullable();
    t.string('category_label', 120).notNullable();
    t.integer('product_count').notNullable().defaultTo(0);
    t.integer('qty_total').notNullable().defaultTo(0);
    t.decimal('wash_price', 12, 2).notNullable().defaultTo(0);
    t.decimal('line_total', 12, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('laundry_job_id').references('laundry_jobs.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('category_id').references('categories.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('laundry_job_category_prices');
  await knex.schema.dropTableIfExists('laundry_job_accessories');
  await knex.schema.dropTableIfExists('laundry_job_products');
  await knex.schema.dropTableIfExists('laundry_jobs');
}
