/** Per-product workshop columns on custom_order_items (measurements, tailor, trial, images). */

const WORKSHOP_COLUMNS = [
  { name: 'measurements', add: (t) => t.json('measurements').nullable() },
  {
    name: 'given_to_tailor',
    add: (t) => t.boolean('given_to_tailor').notNullable().defaultTo(false),
  },
  { name: 'tailor_name', add: (t) => t.string('tailor_name', 120).nullable() },
  { name: 'tailor_date', add: (t) => t.date('tailor_date').nullable() },
  { name: 'trial_date', add: (t) => t.date('trial_date').nullable() },
  { name: 'trial_product', add: (t) => t.string('trial_product', 200).nullable() },
  { name: 'retrials', add: (t) => t.json('retrials').nullable() },
  { name: 'design_images', add: (t) => t.json('design_images').nullable() },
  { name: 'trial_images', add: (t) => t.json('trial_images').nullable() },
];

let ensured = false;

/**
 * Add missing workshop columns so custom-order save does not hit ER_BAD_FIELD_ERROR
 * when the Knex migration has not been applied yet.
 * @param {import('knex').Knex} knex
 */
export async function ensureCustomOrderItemWorkshopColumns(knex) {
  if (ensured) return;
  const hasTable = await knex.schema.hasTable('custom_order_items');
  if (!hasTable) return;

  for (const col of WORKSHOP_COLUMNS) {
    if (await knex.schema.hasColumn('custom_order_items', col.name)) continue;
    await knex.schema.alterTable('custom_order_items', col.add);
  }
  ensured = true;
}
