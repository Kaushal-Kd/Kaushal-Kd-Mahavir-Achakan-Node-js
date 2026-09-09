/** Track only the affected units when a multi-quantity accessory is missing or damaged. */
export async function up(knex) {
  const hasDamagedQty = await knex.schema.hasColumn('order_accessories', 'damaged_qty');
  const hasMissingQty = await knex.schema.hasColumn('order_accessories', 'missing_qty');

  await knex.schema.alterTable('order_accessories', (table) => {
    if (!hasDamagedQty) table.integer('damaged_qty').unsigned().notNullable().defaultTo(0);
    if (!hasMissingQty) table.integer('missing_qty').unsigned().notNullable().defaultTo(0);
  });

  await knex('order_accessories')
    .where({ damaged: true })
    .update({ damaged_qty: knex.raw('GREATEST(1, qty)') });
  await knex('order_accessories')
    .where({ missing: true })
    .update({ missing_qty: knex.raw('GREATEST(1, qty)') });
}

export async function down(knex) {
  const hasDamagedQty = await knex.schema.hasColumn('order_accessories', 'damaged_qty');
  const hasMissingQty = await knex.schema.hasColumn('order_accessories', 'missing_qty');
  await knex.schema.alterTable('order_accessories', (table) => {
    if (hasMissingQty) table.dropColumn('missing_qty');
    if (hasDamagedQty) table.dropColumn('damaged_qty');
  });
}
