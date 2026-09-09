/**
 * Performance indexes for hot multi-tenant query paths.
 *
 * Every list/report query starts with `shop_id` and then filters by some
 * combination of `is_deleted` / `is_active` / status / date columns, plus
 * aggregates by `order_id` on line tables. The composites added here align
 * with the actual query shapes in apps/backend/src/modules/* services so the
 * MySQL planner can satisfy filter + sort from a single index range scan
 * instead of doing post-fetch filtering and filesort.
 *
 * No FULLTEXT here: LIKE '%term%' searches in paginate() need a separate
 * service-code change to MATCH AGAINST.
 */

/**
 * @param {import('knex').Knex} knex
 * @param {string} table
 * @param {string[]} columns
 * @param {string} name
 */
async function safeAddIndex(knex, table, columns, name) {
  try {
    await knex.schema.alterTable(table, (t) => {
      t.index(columns, name);
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (!/Duplicate key name|already exists|doesn'?t exist/i.test(msg)) throw err;
  }
}

/**
 * @param {import('knex').Knex} knex
 * @param {string} table
 * @param {string} name
 */
async function safeDropIndex(knex, table, name) {
  try {
    await knex.schema.alterTable(table, (t) => {
      t.dropIndex([], name);
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (!/check that column.key.exists|doesn'?t exist|Can'?t DROP|not found/i.test(msg)) throw err;
  }
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // orders: list, dashboard, calendar, reports
  await safeAddIndex(knex, 'orders', ['shop_id', 'is_deleted', 'booking_date'], 'idx_orders_shop_deleted_booking');
  await safeAddIndex(knex, 'orders', ['shop_id', 'is_deleted', 'created_at'], 'idx_orders_shop_deleted_created');
  await safeAddIndex(knex, 'orders', ['shop_id', 'is_deleted', 'status', 'pickup_date'], 'idx_orders_shop_deleted_status_pickup');
  await safeAddIndex(knex, 'orders', ['shop_id', 'is_deleted', 'balance', 'status'], 'idx_orders_shop_deleted_balance_status');

  // order_items: kills the per-row correlated SUM in orders.listOrders and
  // the products active-rent subquery used in catalog/availability.
  await safeAddIndex(knex, 'order_items', ['order_id', 'type'], 'idx_order_items_order_type');
  await safeAddIndex(knex, 'order_items', ['shop_id', 'product_id', 'type'], 'idx_order_items_shop_product_type');

  // order_accessories: same correlated-SUM problem + accessory booking checks.
  await safeAddIndex(knex, 'order_accessories', ['order_id', 'type'], 'idx_order_accessories_order_type');
  await safeAddIndex(knex, 'order_accessories', ['shop_id', 'accessory_id', 'order_id'], 'idx_order_accessories_shop_acc_order');

  // payments: recomputeOrderPayment (fires on every payment write),
  // dashboard revenue, account ledger reports.
  await safeAddIndex(knex, 'payments', ['shop_id', 'is_deleted', 'payment_date'], 'idx_payments_shop_deleted_date');
  await safeAddIndex(knex, 'payments', ['order_id', 'is_deleted', 'category'], 'idx_payments_order_deleted_category');
  await safeAddIndex(knex, 'payments', ['shop_id', 'payment_account_id', 'is_deleted', 'payment_date'], 'idx_payments_shop_acct_deleted_date');

  // customers: default list sort.
  await safeAddIndex(knex, 'customers', ['shop_id', 'is_active', 'created_at'], 'idx_customers_shop_active_created');

  // products: default list sort + inventory report.
  await safeAddIndex(knex, 'products', ['shop_id', 'is_active', 'created_at'], 'idx_products_shop_active_created');
  await safeAddIndex(knex, 'products', ['shop_id', 'is_active', 'status'], 'idx_products_shop_active_status');

  // accessories: default list sort + filter.
  await safeAddIndex(knex, 'accessories', ['shop_id', 'is_active', 'created_at'], 'idx_accessories_shop_active_created');
  await safeAddIndex(knex, 'accessories', ['shop_id', 'is_active', 'category_id'], 'idx_accessories_shop_active_category');

  // reminders: only had shop_id; UI sorts by reminder_date.
  await safeAddIndex(knex, 'reminders', ['shop_id', 'reminder_date'], 'idx_reminders_shop_date');

  // laundry_jobs: date filter + default sort.
  await safeAddIndex(knex, 'laundry_jobs', ['shop_id', 'laundry_date'], 'idx_laundry_jobs_shop_date');
  await safeAddIndex(knex, 'laundry_jobs', ['shop_id', 'created_at'], 'idx_laundry_jobs_shop_created');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await safeDropIndex(knex, 'laundry_jobs', 'idx_laundry_jobs_shop_created');
  await safeDropIndex(knex, 'laundry_jobs', 'idx_laundry_jobs_shop_date');

  await safeDropIndex(knex, 'reminders', 'idx_reminders_shop_date');

  await safeDropIndex(knex, 'accessories', 'idx_accessories_shop_active_category');
  await safeDropIndex(knex, 'accessories', 'idx_accessories_shop_active_created');

  await safeDropIndex(knex, 'products', 'idx_products_shop_active_status');
  await safeDropIndex(knex, 'products', 'idx_products_shop_active_created');

  await safeDropIndex(knex, 'customers', 'idx_customers_shop_active_created');

  await safeDropIndex(knex, 'payments', 'idx_payments_shop_acct_deleted_date');
  await safeDropIndex(knex, 'payments', 'idx_payments_order_deleted_category');
  await safeDropIndex(knex, 'payments', 'idx_payments_shop_deleted_date');

  await safeDropIndex(knex, 'order_accessories', 'idx_order_accessories_shop_acc_order');
  await safeDropIndex(knex, 'order_accessories', 'idx_order_accessories_order_type');

  await safeDropIndex(knex, 'order_items', 'idx_order_items_shop_product_type');
  await safeDropIndex(knex, 'order_items', 'idx_order_items_order_type');

  await safeDropIndex(knex, 'orders', 'idx_orders_shop_deleted_balance_status');
  await safeDropIndex(knex, 'orders', 'idx_orders_shop_deleted_status_pickup');
  await safeDropIndex(knex, 'orders', 'idx_orders_shop_deleted_created');
  await safeDropIndex(knex, 'orders', 'idx_orders_shop_deleted_booking');
}
