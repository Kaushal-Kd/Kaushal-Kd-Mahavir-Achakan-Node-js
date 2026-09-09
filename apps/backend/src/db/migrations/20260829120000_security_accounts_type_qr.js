/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('security_accounts');
  if (!hasTable) return;

  const hasAccountType = await knex.schema.hasColumn('security_accounts', 'account_type');
  if (!hasAccountType) {
    await knex.schema.alterTable('security_accounts', (t) => {
      t.string('account_type', 20).notNullable().defaultTo('cash');
    });
  }

  const hasQrCodeUrl = await knex.schema.hasColumn('security_accounts', 'qr_code_url');
  if (!hasQrCodeUrl) {
    await knex.schema.alterTable('security_accounts', (t) => {
      t.string('qr_code_url', 500).notNullable().defaultTo('');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('security_accounts');
  if (!hasTable) return;

  const hasQrCodeUrl = await knex.schema.hasColumn('security_accounts', 'qr_code_url');
  if (hasQrCodeUrl) {
    await knex.schema.alterTable('security_accounts', (t) => {
      t.dropColumn('qr_code_url');
    });
  }

  const hasAccountType = await knex.schema.hasColumn('security_accounts', 'account_type');
  if (hasAccountType) {
    await knex.schema.alterTable('security_accounts', (t) => {
      t.dropColumn('account_type');
    });
  }
}
