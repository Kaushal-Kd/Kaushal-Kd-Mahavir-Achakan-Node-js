/**
 * Keep the accessory category and the individual accessory snapshot separately.
 * Older rows stored the category label in accessory_name, so linked rows are
 * repaired from the accessory and category masters during the migration.
 */
export async function up(knex) {
  const hasCategoryLabel = await knex.schema.hasColumn('laundry_job_accessories', 'category_label');
  if (!hasCategoryLabel) {
    await knex.schema.alterTable('laundry_job_accessories', (table) => {
      table.string('category_label', 120).nullable();
    });
  }

  await knex.raw(`
    UPDATE laundry_job_accessories AS lja
    LEFT JOIN accessories AS a ON a.id = lja.accessory_id
    LEFT JOIN categories AS c ON c.id = lja.category_id
    SET
      lja.category_label = COALESCE(c.label, lja.accessory_name),
      lja.accessory_name = COALESCE(a.name, lja.accessory_name)
    WHERE lja.category_label IS NULL OR lja.category_label = ''
  `);
}

export async function down(knex) {
  const hasCategoryLabel = await knex.schema.hasColumn('laundry_job_accessories', 'category_label');
  if (hasCategoryLabel) {
    await knex.schema.alterTable('laundry_job_accessories', (table) => {
      table.dropColumn('category_label');
    });
  }
}
