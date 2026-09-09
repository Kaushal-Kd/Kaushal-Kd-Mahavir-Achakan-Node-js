/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('categories', (t) => {
    t.boolean('is_washable').notNullable().defaultTo(false);
    t.decimal('dc_price', 10, 2).notNullable().defaultTo(0);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('categories', (t) => {
    t.dropColumn('is_washable');
    t.dropColumn('dc_price');
  });
}

