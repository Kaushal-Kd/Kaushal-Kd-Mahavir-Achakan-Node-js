/**
 * Whether accessory lines on a purchase bill updated CRM accessory qty.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('purchases', 'update_accessory_stock');
  if (hasColumn) return;
  await knex.schema.alterTable('purchases', (t) => {
    t.boolean('update_accessory_stock').notNullable().defaultTo(true);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('purchases', 'update_accessory_stock');
  if (!hasColumn) return;
  await knex.schema.alterTable('purchases', (t) => {
    t.dropColumn('update_accessory_stock');
  });
}
