/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('import_jobs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('created_by').nullable().index();
    t.string('entity', 30).notNullable(); // product | accessory
    t.string('file_name', 255).nullable();
    t.string('status', 20).notNullable().defaultTo('processing'); // processing | completed | failed
    t.integer('total_rows').notNullable().defaultTo(0);
    t.integer('success_rows').notNullable().defaultTo(0);
    t.integer('failed_rows').notNullable().defaultTo(0);
    t.integer('error_count').notNullable().defaultTo(0);
    t.text('summary_message').nullable();
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('created_by').references('users.id').onDelete('SET NULL');
    t.index(['shop_id', 'created_at']);
  });

  await knex.schema.createTable('import_job_errors', (t) => {
    t.uuid('id').primary();
    t.uuid('job_id').notNullable().index();
    t.integer('row_number').notNullable();
    t.string('entity_code', 120).nullable();
    t.text('error_message').notNullable();
    t.text('row_payload').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('job_id').references('import_jobs.id').onDelete('CASCADE');
    t.index(['job_id', 'row_number']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('import_job_errors');
  await knex.schema.dropTableIfExists('import_jobs');
}
