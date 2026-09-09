/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('system_logs', (table) => {
    table.index(
      ['shop_id', 'module', 'entity_id', 'change_count'],
      'system_logs_audit_summary_idx'
    );
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('system_logs', (table) => {
    table.dropIndex(
      ['shop_id', 'module', 'entity_id', 'change_count'],
      'system_logs_audit_summary_idx'
    );
  });
}
