import { naturalSortKey } from '@wrs/shared';

const BACKFILL_CHUNK = 200;

async function addSortKey(knex, tableName) {
  const hasColumn = await knex.schema.hasColumn(tableName, 'natural_code_sort_key');
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, (table) => {
      table.string('natural_code_sort_key', 255).notNullable().defaultTo('').index();
    });
  }

  const rows = await knex(tableName).select('id', 'code').where('natural_code_sort_key', '');
  for (let i = 0; i < rows.length; i += BACKFILL_CHUNK) {
    const chunk = rows.slice(i, i + BACKFILL_CHUNK);
    await knex.transaction(async (trx) => {
      for (const row of chunk) {
        await trx(tableName)
          .where({ id: row.id })
          .update({ natural_code_sort_key: naturalSortKey(row.code) });
      }
    });
  }
}

export async function up(knex) {
  await addSortKey(knex, 'products');
  await addSortKey(knex, 'accessories');
}

export async function down(knex) {
  for (const tableName of ['accessories', 'products']) {
    const hasColumn = await knex.schema.hasColumn(tableName, 'natural_code_sort_key');
    if (hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn('natural_code_sort_key');
      });
    }
  }
}
