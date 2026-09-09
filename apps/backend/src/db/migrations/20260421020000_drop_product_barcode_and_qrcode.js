/**
 * Remove the `barcode` and `qr_code` columns from `products`.
 *
 * Barcodes are now rendered on-the-fly from the product `code` (which is
 * already unique per shop and auto-generated via the product-code format
 * in Configuration). Printed labels encode the code directly, so storing
 * a separate barcode string buys us nothing and just drifts out of sync.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasBarcode = await knex.schema.hasColumn('products', 'barcode');
  const hasQr = await knex.schema.hasColumn('products', 'qr_code');
  if (!hasBarcode && !hasQr) return;

  await knex.schema.alterTable('products', (t) => {
    if (hasBarcode) {
      // Drop the index (if any) before the column so MySQL is happy.
      try {
        t.dropIndex('barcode');
      } catch {
        /* index may not exist on older DBs */
      }
      t.dropColumn('barcode');
    }
    if (hasQr) t.dropColumn('qr_code');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasBarcode = await knex.schema.hasColumn('products', 'barcode');
  const hasQr = await knex.schema.hasColumn('products', 'qr_code');

  await knex.schema.alterTable('products', (t) => {
    if (!hasBarcode) t.string('barcode', 100).nullable().index();
    if (!hasQr) t.string('qr_code', 200).nullable();
  });
}
