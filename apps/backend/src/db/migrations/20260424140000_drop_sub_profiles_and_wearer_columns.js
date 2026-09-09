/**
 * Remove customer_sub_profiles and wearer/sub-profile fields from line items.
 * (Legacy `measurements` table is dropped in a later migration.)
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (await knex.schema.hasTable('measurements')) {
    if (await knex.schema.hasColumn('measurements', 'sub_profile_id')) {
      await knex.schema.alterTable('measurements', (t) => {
        t.dropColumn('sub_profile_id');
      });
    }
  }

  for (const col of ['wearer_name', 'wearer_role', 'sub_profile_id']) {
    const has = await knex.schema.hasColumn('order_items', col);
    if (has) {
      await knex.schema.alterTable('order_items', (t) => {
        t.dropColumn(col);
      });
    }
  }

  const hasSubProfiles = await knex.schema.hasTable('customer_sub_profiles');
  if (hasSubProfiles) {
    await knex.schema.dropTableIfExists('customer_sub_profiles');
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
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

  if (await knex.schema.hasTable('measurements')) {
    await knex.schema.alterTable('measurements', (t) => {
      t.uuid('sub_profile_id').nullable().index();
    });
  }

  await knex.schema.alterTable('order_items', (t) => {
    t.string('wearer_name', 200).nullable();
    t.string('wearer_role', 40).nullable();
    t.uuid('sub_profile_id').nullable();
  });
}
