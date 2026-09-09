/**
 * Accessory colour, size and damaged stock.
 *
 * - color / size: products already carry these (`20260101000200_products_and_accessories.js:32-34`)
 *   but accessories only had a category. Both nullable — plenty of accessories
 *   have neither.
 * - damaged_qty: damage was previously only a boolean on an individual order
 *   line, with no quantity and no link back to catalogue stock, which is why a
 *   shortfall between total and in-shop qty was unexplainable. This makes
 *   damaged stock a first-class number that is excluded from rentable qty.
 *   Mirrors the `spare_qty` shape from `20260911120000_accessories_spare_qty.js`.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('accessories', (t) => {
    t.string('color', 60).nullable();
    t.string('size', 40).nullable();
    t.integer('damaged_qty').unsigned().notNullable().defaultTo(0);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('accessories', (t) => {
    t.dropColumn('color');
    t.dropColumn('size');
    t.dropColumn('damaged_qty');
  });
}
