/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasTable('laundry_job_return_logs');
  if (has) return;

  await knex.schema.createTable('laundry_job_return_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('laundry_job_id').notNullable().index();
    t.uuid('batch_id').notNullable().index();
    t.datetime('returned_at').notNullable();
    t.enu('item_type', ['product', 'accessory']).notNullable();
    t.uuid('line_id').notNullable();
    t.string('item_code', 80).nullable();
    t.string('item_name', 200).notNullable();
    t.string('category_label', 120).nullable();
    t.integer('qty').notNullable().unsigned().defaultTo(1);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('laundry_job_id').references('laundry_jobs.id').onDelete('CASCADE');
    t.index(['laundry_job_id', 'returned_at']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('laundry_job_return_logs');
}
