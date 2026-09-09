export const requiresExplicitRun = true;

export async function up(knex) {
  await knex.schema.alterTable('whatsapp_scheduled_messages', (table) => {
    table.uuid('lease_token').nullable();
    table.timestamp('lease_expires_at').nullable().index();
    table.timestamp('dispatch_started_at').nullable();
  });
  await knex.schema.createTable('whatsapp_reminder_attempts', (table) => {
    table.uuid('id').primary();
    table.uuid('job_id').notNullable().index();
    table.uuid('shop_id').notNullable().index();
    table.uuid('message_log_id').nullable();
    table.string('status', 20).notNullable();
    table.text('error').nullable();
    table.timestamps(true, true);
    table.foreign('job_id').references('whatsapp_scheduled_messages.id').onDelete('CASCADE');
  });
  // Older processing rows have no durable marker proving whether a send started.
  await knex('whatsapp_scheduled_messages').where({ status: 'processing' }).update({
    status: 'uncertain',
    last_error: 'Delivery outcome from an earlier worker is unknown. Check WhatsApp before resending.',
  });
}

export async function down(knex) {
  await knex.schema.dropTable('whatsapp_reminder_attempts');
  await knex.schema.alterTable('whatsapp_scheduled_messages', (table) => {
    table.dropColumn('dispatch_started_at');
    table.dropColumn('lease_expires_at');
    table.dropColumn('lease_token');
  });
}
