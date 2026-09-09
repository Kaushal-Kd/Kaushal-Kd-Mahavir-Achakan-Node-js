/**
 * Remove per-item measurement + note columns from order_items.
 * These fields are no longer used in booking flow.
 */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('order_items');
  if (!hasTable) return;

  const hasLength = await knex.schema.hasColumn('order_items', 'length_inch');
  const hasSleeves = await knex.schema.hasColumn('order_items', 'sleeves_inch');
  const hasCustomerNotes = await knex.schema.hasColumn('order_items', 'customer_notes');

  await knex.schema.alterTable('order_items', (t) => {
    if (hasLength) t.dropColumn('length_inch');
    if (hasSleeves) t.dropColumn('sleeves_inch');
    if (hasCustomerNotes) t.dropColumn('customer_notes');
  });
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('order_items');
  if (!hasTable) return;

  const hasLength = await knex.schema.hasColumn('order_items', 'length_inch');
  const hasSleeves = await knex.schema.hasColumn('order_items', 'sleeves_inch');
  const hasCustomerNotes = await knex.schema.hasColumn('order_items', 'customer_notes');

  await knex.schema.alterTable('order_items', (t) => {
    if (!hasLength) t.decimal('length_inch', 6, 2).nullable();
    if (!hasSleeves) t.decimal('sleeves_inch', 6, 2).nullable();
    if (!hasCustomerNotes) t.text('customer_notes').nullable();
  });
}
