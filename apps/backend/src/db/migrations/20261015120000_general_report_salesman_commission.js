export async function up(knex) {
  const hasBasis = await knex.schema.hasColumn('users_shops', 'commission_basis');
  const hasRate = await knex.schema.hasColumn('users_shops', 'commission_rate');

  await knex.schema.alterTable('users_shops', (table) => {
    if (!hasBasis) table.string('commission_basis', 20).nullable();
    if (!hasRate) table.decimal('commission_rate', 12, 2).notNullable().defaultTo(0);
  });
}

export async function down(knex) {
  const hasBasis = await knex.schema.hasColumn('users_shops', 'commission_basis');
  const hasRate = await knex.schema.hasColumn('users_shops', 'commission_rate');

  await knex.schema.alterTable('users_shops', (table) => {
    if (hasRate) table.dropColumn('commission_rate');
    if (hasBasis) table.dropColumn('commission_basis');
  });
}
