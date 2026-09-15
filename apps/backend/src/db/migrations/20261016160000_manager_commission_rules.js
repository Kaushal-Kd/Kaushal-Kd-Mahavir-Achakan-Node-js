export async function up(knex) {
  const columns = [
    [
      'manager_user_id',
      (table) => {
        table.uuid('manager_user_id').nullable().index();
        table
          .foreign('manager_user_id', 'users_shops_manager_user_fk')
          .references('users.id')
          .onDelete('SET NULL');
      },
    ],
    [
      'self_booking_commission_rate',
      (table) => table.decimal('self_booking_commission_rate', 12, 2).notNullable().defaultTo(0),
    ],
    [
      'self_product_commission_rate',
      (table) => table.decimal('self_product_commission_rate', 12, 2).notNullable().defaultTo(0),
    ],
    [
      'managed_booking_commission_rate',
      (table) => table.decimal('managed_booking_commission_rate', 12, 2).notNullable().defaultTo(0),
    ],
    [
      'managed_product_commission_rate',
      (table) => table.decimal('managed_product_commission_rate', 12, 2).notNullable().defaultTo(0),
    ],
  ];

  for (const [name, addColumn] of columns) {
    if (!(await knex.schema.hasColumn('users_shops', name))) {
      await knex.schema.alterTable('users_shops', addColumn);
    }
  }

  await knex('users_shops')
    .where('commission_basis', 'booking')
    .where('self_booking_commission_rate', 0)
    .update({ self_booking_commission_rate: knex.ref('commission_rate') });
  await knex('users_shops')
    .where('commission_basis', 'product')
    .where('self_product_commission_rate', 0)
    .update({ self_product_commission_rate: knex.ref('commission_rate') });

  if (!(await knex.schema.hasTable('commission_category_rates'))) {
    await knex.schema.createTable('commission_category_rates', (table) => {
      table.uuid('id').primary();
      table.uuid('shop_id').notNullable().index();
      table.uuid('user_id').notNullable().index();
      table.uuid('category_id').notNullable().index();
      table.decimal('self_rate', 12, 2).notNullable().defaultTo(0);
      table.decimal('managed_rate', 12, 2).notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['shop_id', 'user_id', 'category_id']);
      table.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      table.foreign('user_id').references('users.id').onDelete('CASCADE');
      table.foreign('category_id').references('categories.id').onDelete('CASCADE');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('commission_category_rates');
  if (await knex.schema.hasColumn('users_shops', 'manager_user_id')) {
    await knex.schema.alterTable('users_shops', (table) => {
      table.dropForeign('manager_user_id', 'users_shops_manager_user_fk');
    });
  }
  for (const name of [
    'managed_product_commission_rate',
    'managed_booking_commission_rate',
    'self_product_commission_rate',
    'self_booking_commission_rate',
    'manager_user_id',
  ]) {
    if (await knex.schema.hasColumn('users_shops', name)) {
      await knex.schema.alterTable('users_shops', (table) => table.dropColumn(name));
    }
  }
}
