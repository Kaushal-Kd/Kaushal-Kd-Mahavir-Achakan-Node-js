/** Per-product measurements, tailor, trial, and design images on custom order items. */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('custom_order_items');
  if (!hasTable) return;

  const addIfMissing = async (column, fn) => {
    if (await knex.schema.hasColumn('custom_order_items', column)) return;
    await knex.schema.alterTable('custom_order_items', fn);
  };

  await addIfMissing('measurements', (t) => t.json('measurements').nullable());
  await addIfMissing('given_to_tailor', (t) => t.boolean('given_to_tailor').notNullable().defaultTo(false));
  await addIfMissing('tailor_name', (t) => t.string('tailor_name', 120).nullable());
  await addIfMissing('tailor_date', (t) => t.date('tailor_date').nullable());
  await addIfMissing('trial_date', (t) => t.date('trial_date').nullable());
  await addIfMissing('trial_product', (t) => t.string('trial_product', 200).nullable());
  await addIfMissing('retrials', (t) => t.json('retrials').nullable());
  await addIfMissing('design_images', (t) => t.json('design_images').nullable());
  await addIfMissing('trial_images', (t) => t.json('trial_images').nullable());

  const hasParent = await knex.schema.hasTable('custom_orders');
  if (!hasParent) return;

  await knex.raw(`
    UPDATE custom_order_items i
    INNER JOIN custom_orders o ON o.id = i.custom_order_id
    INNER JOIN (
      SELECT custom_order_id, MIN(display_order) AS display_order
      FROM custom_order_items
      GROUP BY custom_order_id
    ) first ON first.custom_order_id = i.custom_order_id
      AND first.display_order = i.display_order
    SET
      i.measurements = o.measurements,
      i.given_to_tailor = o.given_to_tailor,
      i.tailor_name = o.tailor_name,
      i.tailor_date = o.tailor_date,
      i.trial_date = o.trial_date,
      i.trial_product = o.trial_product,
      i.retrials = COALESCE(o.retrials, JSON_ARRAY()),
      i.design_images = COALESCE(o.design_images, JSON_ARRAY()),
      i.trial_images = COALESCE(o.trial_images, JSON_ARRAY()),
      i.updated_at = CURRENT_TIMESTAMP
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('custom_order_items');
  if (!hasTable) return;
  const cols = [
    'measurements',
    'given_to_tailor',
    'tailor_name',
    'tailor_date',
    'trial_date',
    'trial_product',
    'retrials',
    'design_images',
    'trial_images',
  ];
  for (const column of cols) {
    if (await knex.schema.hasColumn('custom_order_items', column)) {
      await knex.schema.alterTable('custom_order_items', (t) => {
        t.dropColumn(column);
      });
    }
  }
}
