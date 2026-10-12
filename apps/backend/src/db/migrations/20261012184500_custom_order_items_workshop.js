import { ensureCustomOrderItemWorkshopColumns } from '../customOrderItemWorkshop.js';

/** Apply workshop columns on custom_order_items before later dated files. */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await ensureCustomOrderItemWorkshopColumns(knex);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('custom_order_items');
  if (!hasTable) return;
  const cols = [
    'measurements',
    'given_to_tailor',
    'tailor_name',
    'tailor_date',
    'trial_date',
    'trial_product',
    'retrials',
    'design_images',
    'trial_images',
  ];
  for (const column of cols) {
    if (await knex.schema.hasColumn('custom_order_items', column)) {
      await knex.schema.alterTable('custom_order_items', (t) => {
        t.dropColumn(column);
      });
    }
  }
}
