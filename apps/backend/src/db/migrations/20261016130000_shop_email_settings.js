export async function up(knex) {
  await knex.schema.createTable('shop_email_settings', (table) => {
    table.uuid('shop_id').primary().references('id').inTable('shops').onDelete('CASCADE');
    table.string('host', 253).notNullable();
    table.integer('port').unsigned().notNullable();
    table.string('username', 320).notNullable();
    table.string('from_email', 254).notNullable();
    table.text('password_ciphertext').notNullable();
    table.uuid('revision').notNullable();
    table
      .uuid('updated_by_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    table.timestamp('test_requested_at').nullable();
    table.timestamp('last_test_at').nullable();
    table.string('last_test_status', 20).nullable();
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('shop_email_settings');
}
