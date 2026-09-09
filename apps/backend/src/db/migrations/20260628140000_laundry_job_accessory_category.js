/**
 * Laundry accessory lines are tracked by accessory category (qty + rate), not individual SKUs.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('laundry_job_accessories', 'category_id');
  if (!has) {
    await knex.schema.alterTable('laundry_job_accessories', (t) => {
      t.uuid('category_id').nullable().index();
      t.foreign('category_id').references('categories.id').onDelete('SET NULL');
    });
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('laundry_job_accessories', 'category_id');
  if (has) {
    await knex.schema.alterTable('laundry_job_accessories', (t) => {
      t.dropForeign(['category_id']);
      t.dropColumn('category_id');
    });
  }
}
