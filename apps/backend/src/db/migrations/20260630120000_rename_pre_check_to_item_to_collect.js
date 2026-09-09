/** Rename order status and checklist stage pre_check → item_to_collect. */

const ORDER_STATUS_ENUM = `
  'draft',
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
  'delivered',
  'partially_returned',
  'returned',
  'closed',
  'cancelled'
`;

const ORDER_STATUS_ENUM_LEGACY = `
  'draft',
  'booked',
  'pending',
  'confirmed',
  'pre_check',
  'in_preparation',
  'ready_for_delivery',
  'delivered',
  'partially_returned',
  'returned',
  'closed',
  'cancelled'
`;

async function migrateStageFlagsJson(knex, table, fromKey, toKey) {
  const pathFrom = `$.${fromKey}`;
  const pathTo = `$.${toKey}`;
  await knex.raw(
    `
    UPDATE \`${table}\` AS t
    SET t.stage_flags = JSON_REMOVE(
      JSON_SET(
        COALESCE(t.stage_flags, JSON_OBJECT()),
        ?,
        COALESCE(JSON_EXTRACT(t.stage_flags, ?), false)
      ),
      ?
    )
    WHERE t.stage_flags IS NOT NULL
      AND JSON_EXTRACT(t.stage_flags, ?) IS NOT NULL
    `,
    [pathTo, pathFrom, pathFrom, pathFrom]
  );
}

async function revertStageFlagsJson(knex, table, fromKey, toKey) {
  const pathFrom = `$.${fromKey}`;
  const pathTo = `$.${toKey}`;
  await knex.raw(
    `
    UPDATE \`${table}\` AS t
    SET t.stage_flags = JSON_REMOVE(
      JSON_SET(
        COALESCE(t.stage_flags, JSON_OBJECT()),
        ?,
        COALESCE(JSON_EXTRACT(t.stage_flags, ?), false)
      ),
      ?
    )
    WHERE t.stage_flags IS NOT NULL
      AND JSON_EXTRACT(t.stage_flags, ?) IS NOT NULL
    `,
    [pathTo, pathFrom, pathFrom, pathFrom]
  );
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex('orders').where({ status: 'pre_check' }).update({ status: 'item_to_collect' });

  await migrateStageFlagsJson(knex, 'order_items', 'pre_check', 'item_to_collect');
  await migrateStageFlagsJson(knex, 'order_accessories', 'pre_check', 'item_to_collect');

  await knex.raw(`
    ALTER TABLE orders MODIFY COLUMN status ENUM(${ORDER_STATUS_ENUM}) NOT NULL DEFAULT 'pending'
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('orders').where({ status: 'item_to_collect' }).update({ status: 'pre_check' });

  await revertStageFlagsJson(knex, 'order_items', 'item_to_collect', 'pre_check');
  await revertStageFlagsJson(knex, 'order_accessories', 'item_to_collect', 'pre_check');

  await knex.raw(`
    ALTER TABLE orders MODIFY COLUMN status ENUM(${ORDER_STATUS_ENUM_LEGACY}) NOT NULL DEFAULT 'pending'
  `);
}
