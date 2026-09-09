/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex('accessories').update({ default_type: 'both' });
}

/** @param {import('knex').Knex} knex */
export async function down() {}
