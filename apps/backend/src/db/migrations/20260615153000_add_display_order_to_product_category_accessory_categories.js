export async function up(knex) {
  const exists = await knex.schema.hasTable('product_category_accessory_categories');
  if (!exists) return;

  const hasDisplayOrder = await knex.schema.hasColumn(
    'product_category_accessory_categories',
    'display_order'
  );
  if (!hasDisplayOrder) {
    await knex.schema.alterTable('product_category_accessory_categories', (table) => {
      table.integer('display_order').notNullable().defaultTo(0);
    });
  }

  await knex.raw(`
    UPDATE product_category_accessory_categories pca
    INNER JOIN categories ac ON ac.id = pca.accessory_category_id
    SET pca.display_order = COALESCE(ac.sort_order, 0)
  `);
}

export async function down(knex) {
  const exists = await knex.schema.hasTable('product_category_accessory_categories');
  if (!exists) return;
  const hasDisplayOrder = await knex.schema.hasColumn(
    'product_category_accessory_categories',
    'display_order'
  );
  if (hasDisplayOrder) {
    await knex.schema.alterTable('product_category_accessory_categories', (table) => {
      table.dropColumn('display_order');
    });
  }
}
