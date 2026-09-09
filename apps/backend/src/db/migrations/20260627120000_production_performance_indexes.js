/**
 * Production-scale performance indexes — Phase 2.
 *
 * Covers tables missed by 20260612 migration plus new query paths from
 * reports, ledger, voucher, sales, credit-notes, laundry sub-tables,
 * notifications, audit_logs, and the trial-balance UNION ALL monster.
 *
 * All indexes use safeAdd so the migration is idempotent (re-runnable).
 */

/** @param {import('knex').Knex} knex */
async function safeAddIndex(knex, table, columns, name) {
  try {
    await knex.schema.alterTable(table, (t) => {
      t.index(columns, name);
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/Duplicate key name|already exists|doesn'?t exist/i.test(msg)) throw err;
  }
}

/** @param {import('knex').Knex} knex */
async function safeDropIndex(knex, table, name) {
  try {
    await knex.schema.alterTable(table, (t) => {
      t.dropIndex([], name);
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/check that column.key.exists|doesn'?t exist|Can'?t DROP|not found/i.test(msg)) throw err;
  }
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // ─── payments: sale_id lookups, payment_account_id for ledger/reports ───
  await safeAddIndex(knex, 'payments', ['shop_id', 'sale_id', 'is_deleted'], 'idx_payments_shop_sale_deleted');
  await safeAddIndex(knex, 'payments', ['payment_account_id', 'is_deleted', 'payment_date'], 'idx_payments_acct_deleted_date');

  // ─── income_entries: ledger + daily cashbook + income-expense report ───
  await safeAddIndex(knex, 'income_entries', ['shop_id', 'entry_date'], 'idx_income_entries_shop_date');
  await safeAddIndex(knex, 'income_entries', ['shop_id', 'payment_account_id', 'entry_date'], 'idx_income_entries_shop_payacct_date');
  await safeAddIndex(knex, 'income_entries', ['shop_id', 'income_account_id', 'entry_date'], 'idx_income_entries_shop_incacct_date');

  // ─── expense_entries: ledger + daily cashbook + income-expense report ───
  await safeAddIndex(knex, 'expense_entries', ['shop_id', 'entry_date'], 'idx_expense_entries_shop_date');
  await safeAddIndex(knex, 'expense_entries', ['shop_id', 'payment_account_id', 'entry_date'], 'idx_expense_entries_shop_payacct_date');
  await safeAddIndex(knex, 'expense_entries', ['shop_id', 'expense_account_id', 'entry_date'], 'idx_expense_entries_shop_expacct_date');

  // ─── payment_vouchers: ledger + daily cashbook + trial balance ───
  await safeAddIndex(knex, 'payment_vouchers', ['shop_id', 'entry_date'], 'idx_payment_vouchers_shop_date');
  await safeAddIndex(knex, 'payment_vouchers', ['shop_id', 'credit_account_id', 'entry_date'], 'idx_pv_shop_credit_date');
  await safeAddIndex(knex, 'payment_vouchers', ['shop_id', 'debit_account_id', 'entry_date'], 'idx_pv_shop_debit_date');

  // ─── receipt_vouchers: ledger + trial balance ───
  await safeAddIndex(knex, 'receipt_vouchers', ['shop_id', 'entry_date'], 'idx_receipt_vouchers_shop_date');
  await safeAddIndex(knex, 'receipt_vouchers', ['shop_id', 'debit_account_id', 'entry_date'], 'idx_rv_shop_debit_date');
  await safeAddIndex(knex, 'receipt_vouchers', ['shop_id', 'credit_account_id', 'entry_date'], 'idx_rv_shop_credit_date');

  // ─── journal_vouchers: ledger + trial balance ───
  await safeAddIndex(knex, 'journal_vouchers', ['shop_id', 'entry_date'], 'idx_journal_vouchers_shop_date');
  await safeAddIndex(knex, 'journal_vouchers', ['shop_id', 'debit_account_id', 'entry_date'], 'idx_jv_shop_debit_date');
  await safeAddIndex(knex, 'journal_vouchers', ['shop_id', 'credit_account_id', 'entry_date'], 'idx_jv_shop_credit_date');

  // ─── credit_notes: list + settled filter + customer balance ───
  await safeAddIndex(knex, 'credit_notes', ['shop_id', 'customer_id', 'settled_at'], 'idx_cn_shop_customer_settled');
  await safeAddIndex(knex, 'credit_notes', ['shop_id', 'created_at'], 'idx_cn_shop_created');

  // ─── sales + sale_items ───
  await safeAddIndex(knex, 'sales', ['shop_id', 'sale_date'], 'idx_sales_shop_date');
  await safeAddIndex(knex, 'sales', ['shop_id', 'status'], 'idx_sales_shop_status');
  await safeAddIndex(knex, 'sale_items', ['sale_id'], 'idx_sale_items_sale');

  // ─── laundry sub-tables: job detail + return ───
  await safeAddIndex(knex, 'laundry_job_products', ['laundry_job_id', 'shop_id'], 'idx_ljp_job_shop');
  await safeAddIndex(knex, 'laundry_job_products', ['shop_id', 'status'], 'idx_ljp_shop_status');
  await safeAddIndex(knex, 'laundry_job_products', ['product_id', 'status'], 'idx_ljp_product_status');
  await safeAddIndex(knex, 'laundry_job_accessories', ['laundry_job_id', 'shop_id'], 'idx_lja_job_shop');
  await safeAddIndex(knex, 'laundry_job_category_prices', ['laundry_job_id', 'shop_id'], 'idx_ljcp_job_shop');

  // ─── washing_queue: product lookups ───
  await safeAddIndex(knex, 'washing_queue', ['shop_id', 'product_id'], 'idx_wq_shop_product');
  await safeAddIndex(knex, 'washing_queue', ['shop_id', 'order_item_id'], 'idx_wq_shop_orderitem');

  // ─── orders: additional patterns from dashboard, reports ───
  await safeAddIndex(knex, 'orders', ['shop_id', 'is_deleted', 'payment_status'], 'idx_orders_shop_deleted_paystatus');
  await safeAddIndex(knex, 'orders', ['shop_id', 'customer_id', 'is_deleted'], 'idx_orders_shop_customer_deleted');
  await safeAddIndex(knex, 'orders', ['shop_id', 'is_deleted', 'return_date', 'status'], 'idx_orders_shop_deleted_return_status');

  // ─── order_items: product availability check ───
  await safeAddIndex(knex, 'order_items', ['product_id', 'type', 'shop_id'], 'idx_oi_product_type_shop');

  // ─── order_accessories: availability check ───
  await safeAddIndex(knex, 'order_accessories', ['accessory_id', 'shop_id'], 'idx_oa_accessory_shop');

  // ─── notifications: user inbox ───
  await safeAddIndex(knex, 'notifications', ['shop_id', 'user_id', 'is_read'], 'idx_notif_shop_user_read');

  // ─── audit_logs: high-write table, partition-friendly ───
  await safeAddIndex(knex, 'audit_logs', ['shop_id', 'created_at'], 'idx_audit_shop_created');

  // ─── product_accessories: recommended accessories join ───
  await safeAddIndex(knex, 'product_accessories', ['product_id', 'accessory_id'], 'idx_pa_product_accessory');

  // ─── product_category_accessory_categories: category mapping ───
  await safeAddIndex(knex, 'product_category_accessory_categories', ['product_category_id'], 'idx_pcac_product_cat');

  // ─── customers: phone uniqueness + search ───
  await safeAddIndex(knex, 'customers', ['shop_id', 'phone1', 'is_active'], 'idx_customers_shop_phone_active');

  // ─── order_edit_logs: per-order history ───
  await safeAddIndex(knex, 'order_edit_logs', ['order_id'], 'idx_oel_order');

  // ─── payment_accounts: shop active list (used everywhere) ───
  await safeAddIndex(knex, 'payment_accounts', ['shop_id', 'is_active'], 'idx_payacct_shop_active');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const drops = [
    ['payment_accounts', 'idx_payacct_shop_active'],
    ['order_edit_logs', 'idx_oel_order'],
    ['customers', 'idx_customers_shop_phone_active'],
    ['product_category_accessory_categories', 'idx_pcac_product_cat'],
    ['product_accessories', 'idx_pa_product_accessory'],
    ['audit_logs', 'idx_audit_shop_created'],
    ['notifications', 'idx_notif_shop_user_read'],
    ['order_accessories', 'idx_oa_accessory_shop'],
    ['order_items', 'idx_oi_product_type_shop'],
    ['orders', 'idx_orders_shop_deleted_return_status'],
    ['orders', 'idx_orders_shop_customer_deleted'],
    ['orders', 'idx_orders_shop_deleted_paystatus'],
    ['washing_queue', 'idx_wq_shop_orderitem'],
    ['washing_queue', 'idx_wq_shop_product'],
    ['laundry_job_category_prices', 'idx_ljcp_job_shop'],
    ['laundry_job_accessories', 'idx_lja_job_shop'],
    ['laundry_job_products', 'idx_ljp_product_status'],
    ['laundry_job_products', 'idx_ljp_shop_status'],
    ['laundry_job_products', 'idx_ljp_job_shop'],
    ['sale_items', 'idx_sale_items_sale'],
    ['sales', 'idx_sales_shop_status'],
    ['sales', 'idx_sales_shop_date'],
    ['credit_notes', 'idx_cn_shop_created'],
    ['credit_notes', 'idx_cn_shop_customer_settled'],
    ['journal_vouchers', 'idx_jv_shop_credit_date'],
    ['journal_vouchers', 'idx_jv_shop_debit_date'],
    ['journal_vouchers', 'idx_journal_vouchers_shop_date'],
    ['receipt_vouchers', 'idx_rv_shop_credit_date'],
    ['receipt_vouchers', 'idx_rv_shop_debit_date'],
    ['receipt_vouchers', 'idx_receipt_vouchers_shop_date'],
    ['payment_vouchers', 'idx_pv_shop_debit_date'],
    ['payment_vouchers', 'idx_pv_shop_credit_date'],
    ['payment_vouchers', 'idx_payment_vouchers_shop_date'],
    ['expense_entries', 'idx_expense_entries_shop_expacct_date'],
    ['expense_entries', 'idx_expense_entries_shop_payacct_date'],
    ['expense_entries', 'idx_expense_entries_shop_date'],
    ['income_entries', 'idx_income_entries_shop_incacct_date'],
    ['income_entries', 'idx_income_entries_shop_payacct_date'],
    ['income_entries', 'idx_income_entries_shop_date'],
    ['payments', 'idx_payments_acct_deleted_date'],
    ['payments', 'idx_payments_shop_sale_deleted'],
  ];
  for (const [table, name] of drops) {
    await safeDropIndex(knex, table, name);
  }
}
