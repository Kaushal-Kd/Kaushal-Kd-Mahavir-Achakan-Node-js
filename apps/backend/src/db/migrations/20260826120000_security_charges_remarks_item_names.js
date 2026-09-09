/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.raw(`
    UPDATE security_charges sc
    INNER JOIN order_items oi
      ON oi.id = sc.item_id AND sc.item_type = 'item' AND oi.shop_id = sc.shop_id
    LEFT JOIN products p ON p.id = oi.product_id AND p.shop_id = oi.shop_id
    SET sc.remarks = CONCAT(
      CASE WHEN sc.remarks LIKE 'Backfill%' THEN 'Backfill' ELSE 'Damage/missing' END,
      ' · Item: ',
      COALESCE(
        NULLIF(TRIM(oi.name_snapshot), ''),
        NULLIF(TRIM(p.name), ''),
        NULLIF(TRIM(oi.code_snapshot), ''),
        'Item'
      )
    )
    WHERE sc.item_type = 'item'
      AND sc.item_id IS NOT NULL
      AND (
        sc.remarks LIKE 'Backfill · item%'
        OR sc.remarks LIKE 'Damage/missing · item%'
      )
  `);

  await knex.raw(`
    UPDATE security_charges sc
    INNER JOIN order_accessories oa
      ON oa.id = sc.item_id AND sc.item_type = 'accessory' AND oa.shop_id = sc.shop_id
    LEFT JOIN accessories a ON a.id = oa.accessory_id AND a.shop_id = oa.shop_id
    LEFT JOIN categories cat ON cat.id = a.category_id
    SET sc.remarks = CONCAT(
      CASE WHEN sc.remarks LIKE 'Backfill%' THEN 'Backfill' ELSE 'Damage/missing' END,
      ' · Accessory: ',
      COALESCE(
        NULLIF(TRIM(oa.name_snapshot), ''),
        NULLIF(TRIM(a.name), ''),
        NULLIF(TRIM(cat.label), ''),
        'Accessory'
      )
    )
    WHERE sc.item_type = 'accessory'
      AND sc.item_id IS NOT NULL
      AND (
        sc.remarks LIKE 'Backfill · accessory%'
        OR sc.remarks LIKE 'Damage/missing · accessory%'
      )
  `);
}

/** @param {import('knex').Knex} knex */
export async function down() {
  // remarks cannot be restored to UUID-based text
}
