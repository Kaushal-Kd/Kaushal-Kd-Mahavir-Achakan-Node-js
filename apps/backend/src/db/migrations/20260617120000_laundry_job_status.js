/**
 * Add lifecycle status columns to laundry tables so we can track
 * products through "in_washing" → "returned" / "cancelled".
 */
export async function up(knex) {
  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.enu('status', ['open', 'completed']).notNullable().defaultTo('open').after('remarks');
  });

  await knex.schema.alterTable('laundry_job_products', (t) => {
    t.enu('status', ['in_washing', 'returned', 'cancelled'])
      .notNullable()
      .defaultTo('in_washing')
      .after('qty');
  });

  await knex.schema.alterTable('laundry_job_accessories', (t) => {
    t.enu('status', ['in_washing', 'returned', 'cancelled'])
      .notNullable()
      .defaultTo('in_washing')
      .after('line_total');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('laundry_job_accessories', (t) => {
    t.dropColumn('status');
  });
  await knex.schema.alterTable('laundry_job_products', (t) => {
    t.dropColumn('status');
  });
  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.dropColumn('status');
  });
}
