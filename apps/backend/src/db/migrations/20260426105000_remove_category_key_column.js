/**
 * Remove legacy categories.key field.
 * Category identity now relies on categories.id only.
 */
/** @param {import('knex').Knex} knex */
export async function up(knex) {
  try {
    await knex.schema.alterTable('categories', (t) => {
      t.dropUnique(['shop_id', 'category_type', 'key']);
    });
  } catch {
    /* noop */
  }
  try {
    await knex.schema.alterTable('categories', (t) => {
      t.dropUnique(['shop_id', 'key']);
    });
  } catch {
    /* noop */
  }

  const hasKey = await knex.schema.hasColumn('categories', 'key');
  if (hasKey) {
    await knex.schema.alterTable('categories', (t) => {
      t.dropColumn('key');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasKey = await knex.schema.hasColumn('categories', 'key');
  if (!hasKey) {
    await knex.schema.alterTable('categories', (t) => {
      t.string('key', 80).nullable();
    });
  }

  await knex('categories').whereNull('key').update({
    key: knex.raw("CONCAT('cat_', REPLACE(id, '-', ''))"),
  });

  await knex.schema.alterTable('categories', (t) => {
    t.string('key', 80).notNullable().alter();
  });

  await knex.schema.alterTable('categories', (t) => {
    t.unique(['shop_id', 'category_type', 'key']);
  });
}
