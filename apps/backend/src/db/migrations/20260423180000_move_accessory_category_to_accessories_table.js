/**
 * Move accessory category relation from junction table to single column on accessories.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('accessories', (t) => {
    t.uuid('category_id').nullable().index();
    t.foreign('category_id').references('categories.id').onDelete('SET NULL');
  });

  // Backfill from junction table (pick first category per accessory).
  const rows = await knex('accessory_categories')
    .select('accessory_id')
    .min({ category_id: 'category_id' })
    .groupBy('accessory_id');

  for (const row of rows) {
    await knex('accessories').where({ id: row.accessory_id }).update({ category_id: row.category_id });
  }

  await knex.schema.dropTableIfExists('accessory_categories');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.createTable('accessory_categories', (t) => {
    t.uuid('accessory_id').notNullable();
    t.uuid('category_id').notNullable();
    t.primary(['accessory_id', 'category_id']);
    t.foreign('accessory_id').references('accessories.id').onDelete('CASCADE');
    t.foreign('category_id').references('categories.id').onDelete('CASCADE');
  });

  const rows = await knex('accessories').whereNotNull('category_id').select('id', 'category_id');
  if (rows.length) {
    await knex('accessory_categories').insert(
      rows.map((r) => ({ accessory_id: r.id, category_id: r.category_id }))
    );
  }

  await knex.schema.alterTable('accessories', (t) => {
    t.dropForeign(['category_id']);
    t.dropColumn('category_id');
  });
}
