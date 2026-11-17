/**
 * Manual paper bill-book number on bookings (free text, not unique) so the shop
 * can match system bookings with its physical bill book.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'bill_book_no');
  if (!hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.string('bill_book_no', 50).nullable();
      t.index(['shop_id', 'bill_book_no'], 'idx_orders_shop_bill_book_no');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('orders', 'bill_book_no');
  if (hasColumn) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropIndex(['shop_id', 'bill_book_no'], 'idx_orders_shop_bill_book_no');
      t.dropColumn('bill_book_no');
    });
  }
}
