/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex('accessories').where('threshold', 0).update({ threshold: 5 });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('accessories').where('threshold', 5).update({ threshold: 0 });
}
