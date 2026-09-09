/**
 * Trim the products table down to the fields actually surfaced in the UI:
 * drop `color_family`, `design_details`, `default_length`, `default_sleeves`
 * and `gap_days`. The remaining rental-lifecycle fields are:
 *   - `lifetime_gap` — maximum number of times this product can be rented.
 *   - `count`        — running total of completed rentals (auto-updated).
 */

const COLUMNS_TO_DROP = [
  'color_family',
  'design_details',
  'default_length',
  'default_sleeves',
  'gap_days',
];

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const existing = [];
  for (const col of COLUMNS_TO_DROP) {
    // eslint-disable-next-line no-await-in-loop
    if (await knex.schema.hasColumn('products', col)) existing.push(col);
  }
  if (!existing.length) return;

  await knex.schema.alterTable('products', (t) => {
    for (const col of existing) t.dropColumn(col);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const missing = [];
  for (const col of COLUMNS_TO_DROP) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasColumn('products', col))) missing.push(col);
  }
  if (!missing.length) return;

  await knex.schema.alterTable('products', (t) => {
    if (missing.includes('color_family')) t.string('color_family', 60).nullable();
    if (missing.includes('design_details')) t.text('design_details').nullable();
    if (missing.includes('default_length')) t.decimal('default_length', 6, 2).nullable();
    if (missing.includes('default_sleeves')) t.decimal('default_sleeves', 6, 2).nullable();
    if (missing.includes('gap_days')) t.integer('gap_days').notNullable().defaultTo(0);
  });
}
