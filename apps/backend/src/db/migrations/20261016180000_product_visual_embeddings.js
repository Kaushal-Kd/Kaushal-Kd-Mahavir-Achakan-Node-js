export async function up(knex) {
  if (await knex.schema.hasTable('product_visual_embeddings')) return;
  await knex.schema.createTable('product_visual_embeddings', (table) => {
    table.uuid('product_id').primary();
    table.uuid('shop_id').notNullable().index();
    table.string('source_image_url', 1000).notNullable();
    table.string('model', 120).notNullable();
    table.json('embedding').notNullable();
    table.timestamp('indexed_at').notNullable().defaultTo(knex.fn.now());
    table.foreign('product_id').references('products.id').onDelete('CASCADE');
    table.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('product_visual_embeddings');
}
