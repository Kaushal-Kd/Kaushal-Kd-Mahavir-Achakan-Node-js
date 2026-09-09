/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('order_items', 'tailor_note_image');
  if (!has) {
    await knex.schema.alterTable('order_items', (t) => {
      t.string('tailor_note_image', 500).nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('order_items', 'tailor_note_image');
  if (has) {
    await knex.schema.alterTable('order_items', (t) => {
      t.dropColumn('tailor_note_image');
    });
  }
}
