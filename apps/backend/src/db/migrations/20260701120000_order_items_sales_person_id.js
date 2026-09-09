/** Per-line salesman on order_items (product-wise in Create Order). */

export async function up(knex) {
  const has = await knex.schema.hasColumn('order_items', 'sales_person_id');
  if (!has) {
    await knex.schema.alterTable('order_items', (t) => {
      t.uuid('sales_person_id').nullable().index();
      t.foreign('sales_person_id').references('users.id').onDelete('SET NULL');
    });
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('order_items', 'sales_person_id');
  if (has) {
    await knex.schema.alterTable('order_items', (t) => {
      t.dropForeign('sales_person_id');
      t.dropColumn('sales_person_id');
    });
  }
}
