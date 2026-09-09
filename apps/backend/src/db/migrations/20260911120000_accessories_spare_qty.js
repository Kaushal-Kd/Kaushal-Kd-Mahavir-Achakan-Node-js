/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('accessories', (t) => {
    t.integer('spare_qty').unsigned().notNullable().defaultTo(0);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('accessories', (t) => {
    t.dropColumn('spare_qty');
  });
}
