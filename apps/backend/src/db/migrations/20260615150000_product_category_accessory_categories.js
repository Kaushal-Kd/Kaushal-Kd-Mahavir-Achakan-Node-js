export async function up(knex) {
  const exists = await knex.schema.hasTable('product_category_accessory_categories');
  if (!exists) {
    await knex.schema.createTable('product_category_accessory_categories', (table) => {
      table.uuid('product_category_id').notNullable();
      table.uuid('accessory_category_id').notNullable();
      table.primary(['product_category_id', 'accessory_category_id']);
      table
        .foreign('product_category_id', 'fk_pcac_product_category')
        .references('id')
        .inTable('categories')
        .onDelete('CASCADE');
      table
        .foreign('accessory_category_id', 'fk_pcac_accessory_category')
        .references('id')
        .inTable('categories')
        .onDelete('CASCADE');
    });
  }

  await knex.raw(`
    INSERT IGNORE INTO product_category_accessory_categories (product_category_id, accessory_category_id)
    SELECT DISTINCT apc.category_id AS product_category_id, a.category_id AS accessory_category_id
    FROM accessory_product_categories apc
    INNER JOIN accessories a ON a.id = apc.accessory_id
    INNER JOIN categories cp ON cp.id = apc.category_id
    INNER JOIN categories ca ON ca.id = a.category_id
    WHERE a.category_id IS NOT NULL
      AND cp.category_type = 'product'
      AND ca.category_type = 'accessory'
  `);
}

export async function down(knex) {
  const exists = await knex.schema.hasTable('product_category_accessory_categories');
  if (exists) {
    await knex.schema.dropTable('product_category_accessory_categories');
  }
}
