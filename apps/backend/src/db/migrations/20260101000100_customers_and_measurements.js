/**
 * Customers (+ legacy customer_sub_profiles; measurements table removed in a later migration).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('customers', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();

    t.string('name', 200).notNullable();
    t.string('phone1', 30).notNullable();
    t.string('phone1_name', 60).nullable();
    t.string('phone2', 30).nullable();
    t.string('phone2_name', 60).nullable();
    t.string('whatsapp', 30).nullable();
    t.string('email', 200).nullable();

    t.text('address').nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('pincode', 20).nullable();

    t.date('dob').nullable();
    t.date('wedding_date').nullable();
    t.date('anniversary').nullable();

    t.string('photo_url', 500).nullable();
    t.string('id_proof_url', 500).nullable();
    t.string('id_proof_type', 40).nullable();
    t.string('id_proof_number', 60).nullable();

    t.boolean('is_vip').notNullable().defaultTo(false);
    t.boolean('is_blacklisted').notNullable().defaultTo(false);
    t.boolean('is_repeat').notNullable().defaultTo(false);

    t.string('lead_source', 100).nullable();
    t.string('referred_by', 200).nullable();

    t.text('notes').nullable();

    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index(['shop_id', 'phone1']);
    t.index(['shop_id', 'name']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('customer_sub_profiles', (t) => {
    t.uuid('id').primary();
    t.uuid('customer_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.string('name', 200).notNullable();
    t.string('phone', 30).nullable();
    t.string('wearer_role', 40).nullable();
    t.string('relation', 60).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('customer_id').references('customers.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('measurements');
  await knex.schema.dropTableIfExists('customer_sub_profiles');
  await knex.schema.dropTableIfExists('customers');
}
