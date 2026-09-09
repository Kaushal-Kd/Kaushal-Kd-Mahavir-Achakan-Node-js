/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('credit_notes', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('customer_id').notNullable().index();
    t.uuid('source_order_id').notNullable().index();
    t.string('note_number', 40).notNullable();
    t.integer('bill_no').notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.decimal('amount_applied', 12, 2).notNullable().defaultTo(0);
    t.text('remarks').nullable();
    t.timestamp('settled_at').nullable();
    t.text('settle_remarks').nullable();
    t.uuid('created_by').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('customer_id').references('customers.id').onDelete('CASCADE');
    t.foreign('source_order_id').references('orders.id').onDelete('CASCADE');
    t.foreign('created_by').references('users.id').onDelete('SET NULL');
    t.unique(['shop_id', 'note_number']);
    t.index(['shop_id', 'customer_id', 'settled_at']);
    t.index(['shop_id', 'created_at']);
  });

  await knex.schema.createTable('credit_note_applications', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('credit_note_id').notNullable().index();
    t.uuid('order_id').notNullable().index();
    t.decimal('amount', 12, 2).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('credit_note_id').references('credit_notes.id').onDelete('CASCADE');
    t.foreign('order_id').references('orders.id').onDelete('CASCADE');
    t.index(['shop_id', 'order_id']);
  });

  await knex.raw(
    "ALTER TABLE payments MODIFY COLUMN category ENUM('advance', 'partial', 'final', 'refund', 'deposit', 'deposit_refund', 'credit_note_issue', 'credit_note_apply') NOT NULL DEFAULT 'partial'"
  );
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('credit_note_applications');
  await knex.schema.dropTableIfExists('credit_notes');
  await knex.raw(
    "ALTER TABLE payments MODIFY COLUMN category ENUM('advance', 'partial', 'final', 'refund', 'deposit', 'deposit_refund') NOT NULL DEFAULT 'partial'"
  );
}
