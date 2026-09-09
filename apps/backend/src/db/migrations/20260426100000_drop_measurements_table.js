/**
 * Remove legacy `measurements` table (no longer used by the app).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.dropTableIfExists('measurements');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasTable('measurements');
  if (has) return;

  await knex.schema.createTable('measurements', (t) => {
    t.uuid('id').primary();
    t.uuid('customer_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('order_id').nullable().index();

    t.decimal('chest', 6, 2).nullable();
    t.decimal('waist', 6, 2).nullable();
    t.decimal('hip', 6, 2).nullable();
    t.decimal('shoulder', 6, 2).nullable();
    t.decimal('height', 6, 2).nullable();
    t.decimal('weight', 6, 2).nullable();
    t.decimal('sleeve_length', 6, 2).nullable();
    t.decimal('sleeve_round', 6, 2).nullable();
    t.decimal('neck', 6, 2).nullable();
    t.decimal('kurta_length', 6, 2).nullable();
    t.decimal('pant_waist', 6, 2).nullable();
    t.decimal('pant_length', 6, 2).nullable();
    t.decimal('pant_bottom', 6, 2).nullable();
    t.decimal('thigh', 6, 2).nullable();
    t.decimal('knee', 6, 2).nullable();
    t.decimal('crotch', 6, 2).nullable();
    t.decimal('front_rise', 6, 2).nullable();
    t.decimal('back_rise', 6, 2).nullable();
    t.string('shoe_size', 20).nullable();
    t.decimal('safa_size', 6, 2).nullable();
    t.decimal('kamar_bandh', 6, 2).nullable();
    t.decimal('dupatta_length', 6, 2).nullable();
    t.decimal('kurti_length', 6, 2).nullable();
    t.decimal('bust', 6, 2).nullable();
    t.decimal('under_bust', 6, 2).nullable();
    t.decimal('lehenga_length', 6, 2).nullable();
    t.decimal('lehenga_waist', 6, 2).nullable();
    t.decimal('lehenga_flare', 6, 2).nullable();
    t.decimal('blouse_front_neck', 6, 2).nullable();
    t.decimal('blouse_back_neck', 6, 2).nullable();
    t.decimal('saree_fall', 6, 2).nullable();
    t.decimal('petticoat_waist', 6, 2).nullable();
    t.string('measurement_sheet_url', 500).nullable();
    t.text('notes').nullable();

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('customer_id').references('customers.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });
}
