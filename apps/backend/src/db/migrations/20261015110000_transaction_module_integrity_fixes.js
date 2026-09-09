import {
  buildExpenseNumber,
  buildIncomeNumber,
  normalizeOrderNumberPrefix,
} from '@wrs/shared';

async function backfillDocumentNumbers(knex, config) {
  const shops = await knex('shops').select('id', 'order_number_prefix');
  for (const shop of shops) {
    const rows = await knex(config.table)
      .where({ shop_id: shop.id })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .select('id', 'bill_no');
    const used = new Set();
    let next = rows.reduce((max, row) => {
      const value = Number(row.bill_no || 0);
      return Number.isInteger(value) && value > max ? value : max;
    }, 0) + 1;
    const shopPrefix = normalizeOrderNumberPrefix(shop.order_number_prefix);
    const prefix = shopPrefix ? `${config.prefix}${shopPrefix}` : config.prefix;

    for (const row of rows) {
      const existing = Number(row.bill_no || 0);
      let billNo = existing;
      if (!Number.isInteger(existing) || existing <= 0 || used.has(existing)) {
        while (used.has(next)) next += 1;
        billNo = next;
        next += 1;
      }
      used.add(billNo);
      await knex(config.table).where({ id: row.id, shop_id: shop.id }).update({
        bill_no: billNo,
        [config.numberColumn]: config.build({ prefix, sequence: billNo }),
      });
    }
  }
}

export async function up(knex) {
  await backfillDocumentNumbers(knex, {
    table: 'income_entries',
    numberColumn: 'income_number',
    prefix: 'I',
    build: buildIncomeNumber,
  });
  await backfillDocumentNumbers(knex, {
    table: 'expense_entries',
    numberColumn: 'expense_number',
    prefix: 'E',
    build: buildExpenseNumber,
  });

  await knex.schema.alterTable('income_entries', (table) => {
    table.integer('bill_no').unsigned().notNullable().alter();
    table.string('income_number', 40).notNullable().alter();
    table.unique(['shop_id', 'bill_no'], { indexName: 'uq_income_entries_shop_bill_no' });
  });
  await knex.schema.alterTable('expense_entries', (table) => {
    table.integer('bill_no').unsigned().notNullable().alter();
    table.string('expense_number', 40).notNullable().alter();
    table.unique(['shop_id', 'bill_no'], { indexName: 'uq_expense_entries_shop_bill_no' });
  });
}

export async function down(knex) {
  await knex.schema.alterTable('expense_entries', (table) => {
    table.dropUnique(['shop_id', 'bill_no'], 'uq_expense_entries_shop_bill_no');
    table.integer('bill_no').unsigned().nullable().alter();
    table.string('expense_number', 40).nullable().alter();
  });
  await knex.schema.alterTable('income_entries', (table) => {
    table.dropUnique(['shop_id', 'bill_no'], 'uq_income_entries_shop_bill_no');
    table.integer('bill_no').unsigned().nullable().alter();
    table.string('income_number', 40).nullable().alter();
  });

  // The preceding feature migration restores washing_queue.product_id to NOT NULL on rollback.
  // Accessory-only queue rows cannot exist in that older schema, so remove them first.
  if (await knex.schema.hasColumn('washing_queue', 'item_kind')) {
    await knex('washing_queue').where('item_kind', 'accessory').del();
  }
}
