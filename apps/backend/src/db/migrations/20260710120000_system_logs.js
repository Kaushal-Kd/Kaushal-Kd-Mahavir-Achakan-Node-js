/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('system_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('module', 40).notNullable();
    t.string('entity_id', 36).notNullable().index();
    t.string('bill_no', 80).nullable();
    t.uuid('user_id').nullable().index();
    t.string('user_name', 200).nullable();
    t.string('action_type', 40).notNullable();
    t.integer('change_count').notNullable().unsigned().defaultTo(1);
    t.string('responsible_by', 200).nullable();
    t.json('bill_data').nullable();
    t.json('product_data').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('user_id').references('users.id').onDelete('SET NULL');
    t.index(['shop_id', 'module', 'created_at']);
    t.index(['shop_id', 'entity_id']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('system_logs');
}
