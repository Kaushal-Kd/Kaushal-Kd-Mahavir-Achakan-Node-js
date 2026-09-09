/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('reminders', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.text('description').notNullable();
    t.string('assignee', 200).notNullable();
    t.date('reminder_date').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('reminders');
}
