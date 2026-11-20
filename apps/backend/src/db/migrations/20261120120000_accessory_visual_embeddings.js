/**
 * Image fingerprints (embeddings) for local, self-hosted accessory visual search.
 * `source` = 'catalog' (from the accessory photo) or 'scan' (a confirmed shop scan,
 * stored as numbers only — the scan photo itself is never saved).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const exists = await knex.schema.hasTable('accessory_visual_embeddings');
  if (exists) return;
  await knex.schema.createTable('accessory_visual_embeddings', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable();
    t.uuid('accessory_id').notNullable();
    t.string('source', 16).notNullable().defaultTo('catalog');
    t.string('image_url', 1000).nullable();
    t.string('model', 80).notNullable();
    t.binary('embedding').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['shop_id', 'model'], 'idx_ave_shop_model');
    t.index(['accessory_id', 'source'], 'idx_ave_accessory_source');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('accessory_visual_embeddings');
}
