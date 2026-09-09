export async function up(knex) {
  await knex.schema.createTable('gst_invoice_sequences', (t) => {
    t.string('gstin', 15).notNullable();
    t.string('financial_year', 5).notNullable();
    t.integer('last_number').unsigned().notNullable().defaultTo(0);
    t.primary(['gstin', 'financial_year']);
  });
  await knex.schema.createTable('gst_invoice_batches', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('actor_id').notNullable();
    t.string('payload_hash', 64).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('gst_invoices', (t) => {
    t.uuid('id').primary();
    t.uuid('batch_id').notNullable().references('id').inTable('gst_invoice_batches');
    t.uuid('shop_id').notNullable().index();
    t.string('source_type', 10).notNullable();
    t.uuid('source_id').notNullable();
    t.string('source_number', 80).notNullable();
    t.string('customer_name', 200).notNullable();
    t.string('supplier_gstin', 15).notNullable();
    t.string('financial_year', 5).notNullable();
    t.string('invoice_number', 16).notNullable();
    t.date('invoice_date').notNullable();
    t.decimal('original_total', 14, 2).notNullable();
    t.decimal('percentage', 5, 2).notNullable();
    for (const name of [
      'grand_total',
      'taxable_value',
      'tax_total',
      'cgst',
      'sgst',
      'igst',
      'non_gst_amount',
    ])
      t.decimal(name, 14, 2).notNullable();
    t.json('snapshot').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['shop_id', 'source_type', 'source_id']);
    t.unique(['supplier_gstin', 'financial_year', 'invoice_number']);
    t.index(['shop_id', 'invoice_date']);
  });
  await knex.schema.createTable('shop_ip_policies', (t) => {
    t.uuid('shop_id').primary().references('id').inTable('shops').onDelete('CASCADE');
    t.boolean('enabled').notNullable().defaultTo(false);
    t.json('allowed_ranges').notNullable();
    t.integer('revision').unsigned().notNullable().defaultTo(0);
    t.uuid('updated_by').nullable();
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('shop_user_ip_policies', (t) => {
    t.uuid('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('mode', 20).notNullable();
    t.json('allowed_ranges').notNullable();
    t.primary(['shop_id', 'user_id']);
  });
  await knex.schema.createTable('shop_ip_commands', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable();
    t.uuid('actor_id').notNullable();
    t.string('payload_hash', 64).notNullable();
    t.integer('revision').unsigned().notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down() {
  throw new Error(
    'Issued GST invoices and IP audit history require a reviewed restore or forward migration'
  );
}
