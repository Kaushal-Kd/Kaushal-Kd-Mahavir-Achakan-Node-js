/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('whatsapp_shop_sessions', (t) => {
    t.uuid('shop_id').primary();
    t.string('status', 32).notNullable().defaultTo('disconnected');
    t.string('phone_number', 32).nullable();
    t.string('wa_jid', 120).nullable();
    t.string('display_name', 200).nullable();
    t.timestamp('connected_at').nullable();
    t.timestamp('disconnected_at').nullable();
    t.timestamp('last_seen_at').nullable();
    t.uuid('connected_by_user_id').nullable().index();
    t.uuid('last_login_user_id').nullable().index();
    t.text('last_error').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('connected_by_user_id').references('users.id').onDelete('SET NULL');
    t.foreign('last_login_user_id').references('users.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('whatsapp_connection_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').nullable().index();
    t.string('event', 40).notNullable();
    t.string('message', 500).nullable();
    t.json('meta').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('user_id').references('users.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('whatsapp_message_logs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').nullable().index();
    t.string('template_key', 80).nullable();
    t.string('recipient_phone', 32).nullable();
    t.string('recipient_jid', 120).nullable();
    t.string('body_preview', 500).nullable();
    t.string('status', 20).notNullable().defaultTo('queued');
    t.text('error_message').nullable();
    t.uuid('order_id').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('user_id').references('users.id').onDelete('SET NULL');
    t.foreign('order_id').references('orders.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('whatsapp_message_logs');
  await knex.schema.dropTableIfExists('whatsapp_connection_logs');
  await knex.schema.dropTableIfExists('whatsapp_shop_sessions');
}
