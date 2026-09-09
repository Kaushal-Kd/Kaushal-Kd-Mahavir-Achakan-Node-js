/**
 * Hard-drop accessory code columns after soft-deprecation rollout.
 * Product code remains untouched; this only removes accessory-code storage.
 */

async function dropIndexIfExists(knex, tableName, indexName) {
  const rows = await knex('INFORMATION_SCHEMA.STATISTICS')
    .where({
      TABLE_SCHEMA: knex.client.database(),
      TABLE_NAME: tableName,
      INDEX_NAME: indexName,
    })
    .select('INDEX_NAME')
    .limit(1);
  if (rows.length > 0) {
    await knex.schema.alterTable(tableName, (t) => {
      t.dropIndex(['shop_id', 'code'], indexName);
    });
  }
}

export async function up(knex) {
  const hasAccessoriesCode = await knex.schema.hasColumn('accessories', 'code');
  if (hasAccessoriesCode) {
    await dropIndexIfExists(knex, 'accessories', 'accessories_shop_id_code_unique');
    await knex.schema.alterTable('accessories', (t) => {
      t.dropColumn('code');
    });
  }

  const hasOrderAccessoryCodeSnapshot = await knex.schema.hasColumn('order_accessories', 'code_snapshot');
  if (hasOrderAccessoryCodeSnapshot) {
    await knex.schema.alterTable('order_accessories', (t) => {
      t.dropColumn('code_snapshot');
    });
  }

  const hasLaundryAccessoryCode = await knex.schema.hasColumn('laundry_job_accessories', 'accessory_code');
  if (hasLaundryAccessoryCode) {
    await knex.schema.alterTable('laundry_job_accessories', (t) => {
      t.dropColumn('accessory_code');
    });
  }
}

export async function down(knex) {
  const hasAccessoriesCode = await knex.schema.hasColumn('accessories', 'code');
  if (!hasAccessoriesCode) {
    await knex.schema.alterTable('accessories', (t) => {
      t.string('code', 80).nullable();
    });
  }

  const hasOrderAccessoryCodeSnapshot = await knex.schema.hasColumn('order_accessories', 'code_snapshot');
  if (!hasOrderAccessoryCodeSnapshot) {
    await knex.schema.alterTable('order_accessories', (t) => {
      t.string('code_snapshot', 80).nullable();
    });
  }

  const hasLaundryAccessoryCode = await knex.schema.hasColumn('laundry_job_accessories', 'accessory_code');
  if (!hasLaundryAccessoryCode) {
    await knex.schema.alterTable('laundry_job_accessories', (t) => {
      t.string('accessory_code', 80).nullable();
    });
  }
}
