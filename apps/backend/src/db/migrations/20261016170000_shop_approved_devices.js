export async function up(knex) {
  if (await knex.schema.hasTable('shop_approved_devices')) return;
  await knex.schema.createTable('shop_approved_devices', (table) => {
    table.uuid('shop_id').notNullable();
    table.uuid('user_id').notNullable();
    table.string('device_id', 128).notNullable();
    table.uuid('approved_by_user_id').nullable();
    table.timestamp('approved_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['shop_id', 'user_id', 'device_id']);
    table.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('approved_by_user_id').references('users.id').onDelete('SET NULL');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('shop_approved_devices');
}
