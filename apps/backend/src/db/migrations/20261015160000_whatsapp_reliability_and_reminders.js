/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('whatsapp_shop_sessions', 'should_reconnect'))) {
    await knex.schema.alterTable('whatsapp_shop_sessions', (t) => {
      t.boolean('should_reconnect').notNullable().defaultTo(false).index();
      t.string('disconnect_kind', 30).nullable();
      t.integer('reconnect_attempts').unsigned().notNullable().defaultTo(0);
      t.timestamp('next_reconnect_at').nullable();
    });
    await knex('whatsapp_shop_sessions')
      .whereIn('status', ['connected', 'reconnecting'])
      .update({ should_reconnect: true });
  }

  if (!(await knex.schema.hasTable('whatsapp_scheduled_messages'))) {
    await knex.schema.createTable('whatsapp_scheduled_messages', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.uuid('order_id').notNullable().index();
      t.string('template_key', 80).notNullable();
      t.date('delivery_date').notNullable();
      t.timestamp('scheduled_for').notNullable().index();
      t.string('status', 20).notNullable().defaultTo('pending').index();
      t.integer('attempt_count').unsigned().notNullable().defaultTo(0);
      t.timestamp('next_attempt_at').nullable().index();
      t.timestamp('sent_at').nullable();
      t.text('last_error').nullable();
      t.uuid('message_log_id').nullable().index();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(
        ['shop_id', 'order_id', 'template_key', 'delivery_date'],
        'uq_whatsapp_scheduled_delivery'
      );
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.foreign('order_id').references('orders.id').onDelete('CASCADE');
      t.foreign('message_log_id').references('whatsapp_message_logs.id').onDelete('SET NULL');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('whatsapp_scheduled_messages');
  if (await knex.schema.hasColumn('whatsapp_shop_sessions', 'should_reconnect')) {
    await knex.schema.alterTable('whatsapp_shop_sessions', (t) => {
      t.dropColumn('should_reconnect');
      t.dropColumn('disconnect_kind');
      t.dropColumn('reconnect_attempts');
      t.dropColumn('next_reconnect_at');
    });
  }
}
