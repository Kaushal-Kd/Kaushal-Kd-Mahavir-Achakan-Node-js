/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasStart = await knex.schema.hasColumn('shops', 'order_start_sequence');
  if (!hasStart) {
    await knex.schema.alterTable('shops', (t) => {
      t.integer('order_start_sequence').unsigned().notNullable().defaultTo(1);
    });
  }

  const hasDocs = await knex.schema.hasColumn('shops', 'document_numbering');
  if (!hasDocs) {
    await knex.schema.alterTable('shops', (t) => {
      t.json('document_numbering').nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  if (await knex.schema.hasColumn('shops', 'document_numbering')) {
    await knex.schema.alterTable('shops', (t) => {
      t.dropColumn('document_numbering');
    });
  }
  if (await knex.schema.hasColumn('shops', 'order_start_sequence')) {
    await knex.schema.alterTable('shops', (t) => {
      t.dropColumn('order_start_sequence');
    });
  }
}
