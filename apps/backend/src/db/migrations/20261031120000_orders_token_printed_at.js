/** Persist whether product / accessory tokens have been printed for a booking. */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasProduct = await knex.schema.hasColumn('orders', 'product_token_printed_at');
  if (!hasProduct) {
    await knex.schema.alterTable('orders', (t) => {
      t.timestamp('product_token_printed_at').nullable();
    });
  }
  const hasAccessory = await knex.schema.hasColumn('orders', 'accessory_token_printed_at');
  if (!hasAccessory) {
    await knex.schema.alterTable('orders', (t) => {
      t.timestamp('accessory_token_printed_at').nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  if (await knex.schema.hasColumn('orders', 'accessory_token_printed_at')) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('accessory_token_printed_at');
    });
  }
  if (await knex.schema.hasColumn('orders', 'product_token_printed_at')) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('product_token_printed_at');
    });
  }
}
