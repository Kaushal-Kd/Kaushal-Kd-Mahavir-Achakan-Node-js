const KEY_PAYMENT = 'config.payment_accounts';
const KEY_SECURITY = 'config.security_accounts';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasPa = await knex.schema.hasTable('payment_accounts');
  if (!hasPa) {
    await knex.schema.createTable('payment_accounts', (t) => {
      t.uuid('shop_id').notNullable();
      t.string('id', 80).notNullable();
      t.string('name', 200).notNullable();
      t.string('contact_no', 30).notNullable().defaultTo('');
      t.string('account_group', 80).notNullable().defaultTo('');
      t.decimal('opening_balance', 12, 2).notNullable().defaultTo(0);
      t.string('date', 20).notNullable().defaultTo('');
      t.string('email', 200).notNullable().defaultTo('');
      t.string('shop_name', 200).notNullable().defaultTo('');
      t.string('address', 500).notNullable().defaultTo('');
      t.string('remarks', 500).notNullable().defaultTo('');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.primary(['shop_id', 'id']);
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.index(['shop_id', 'is_active']);
    });
  }

  const hasSa = await knex.schema.hasTable('security_accounts');
  if (!hasSa) {
    await knex.schema.createTable('security_accounts', (t) => {
      t.uuid('shop_id').notNullable();
      t.string('id', 80).notNullable();
      t.string('name', 200).notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.primary(['shop_id', 'id']);
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.index(['shop_id', 'is_active']);
    });
  }

  const legacyRows = await knex('settings').whereIn('key', [KEY_PAYMENT, KEY_SECURITY]);
  for (const row of legacyRows) {
    const shopId = row.shop_id;
    let arr;
    try {
      arr = JSON.parse(row.value || '[]');
    } catch {
      arr = [];
    }
    if (!Array.isArray(arr)) arr = [];

    if (row.key === KEY_PAYMENT) {
      const seen = new Set();
      for (const item of arr) {
        const id = String(item?.id || '').trim().slice(0, 80);
        if (!id || seen.has(`${shopId}:${id}`)) continue;
        seen.add(`${shopId}:${id}`);
        const exists = await knex('payment_accounts').where({ shop_id: shopId, id }).first();
        if (exists) continue;
        await knex('payment_accounts').insert({
          shop_id: shopId,
          id,
          name: String(item?.name || 'Account').trim().slice(0, 200) || 'Account',
          contact_no: String(item?.contact_no || '').trim().slice(0, 30),
          account_group: String(item?.account_group || '').trim().slice(0, 80),
          opening_balance: Number(item?.opening_balance || 0),
          date: String(item?.date || '').trim().slice(0, 20),
          email: String(item?.email || '').trim().slice(0, 200),
          shop_name: String(item?.shop_name || '').trim().slice(0, 200),
          address: String(item?.address || '').trim().slice(0, 500),
          remarks: String(item?.remarks || '').trim().slice(0, 500),
          is_active: true,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      }
    } else if (row.key === KEY_SECURITY) {
      const seen = new Set();
      for (const item of arr) {
        const id = String(item?.id || '').trim().slice(0, 80);
        if (!id || seen.has(`${shopId}:${id}`)) continue;
        seen.add(`${shopId}:${id}`);
        const exists = await knex('security_accounts').where({ shop_id: shopId, id }).first();
        if (exists) continue;
        await knex('security_accounts').insert({
          shop_id: shopId,
          id,
          name: String(item?.name || 'Security').trim().slice(0, 200) || 'Security',
          is_active: true,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      }
    }
    await knex('settings').where({ id: row.id }).delete();
  }

  if (!(await knex.schema.hasColumn('payments', 'payment_account_id'))) {
    await knex.schema.alterTable('payments', (t) => {
      t.string('payment_account_id', 80).nullable().index();
      t.string('security_account_id', 80).nullable().index();
    });
    // Shop-scoped ledger ids are validated in application code. MySQL rejects
    // composite FK ... ON DELETE SET NULL when `shop_id` in the FK is NOT NULL.
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  if (await knex.schema.hasColumn('payments', 'payment_account_id')) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropColumn('payment_account_id');
      t.dropColumn('security_account_id');
    });
  }
  await knex.schema.dropTableIfExists('security_accounts');
  await knex.schema.dropTableIfExists('payment_accounts');
}
