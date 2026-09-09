import { addDays, normalizeSqlDateToIso, todayIndiaISODate } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

export const requiresExplicitRun = true;

export async function up(knex) {
  await knex.schema.alterTable('order_items', (table) => {
    table.integer('replacement_version').unsigned().notNullable().defaultTo(0);
  });
  await knex.schema.createTable('order_item_replacement_requirements', (table) => {
    table.uuid('id').primary();
    table.uuid('shop_id').notNullable();
    table.uuid('source_order_id').notNullable();
    table.uuid('source_order_item_id').notNullable();
    table.uuid('source_product_id').notNullable();
    table.string('source_product_label', 255).notNullable();
    table.uuid('target_order_id').notNullable();
    table.uuid('target_order_item_id').notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.uuid('replacement_product_id').nullable();
    table.uuid('reminder_id').nullable();
    table.uuid('resolved_by').nullable();
    table.timestamp('resolved_at').nullable();
    table.timestamps(true, true);
    table.unique(['shop_id', 'source_order_item_id', 'target_order_item_id'], 'replacement_source_target_unique');
    table.index(['shop_id', 'target_order_id', 'status'], 'replacement_target_status_idx');
    table.index(['shop_id', 'source_order_id'], 'replacement_source_order_idx');
  });
  const today = todayIndiaISODate();
  for (let offset = 0; ; offset += 500) {
    const affected = await knex('order_items as source')
      .join('orders as source_order', function joinSourceOrder() {
        this.on('source_order.id', '=', 'source.order_id').andOn('source_order.shop_id', '=', 'source.shop_id');
      })
      .join('order_items as target', function joinTarget() {
        this.on('target.product_id', '=', 'source.product_id').andOn('target.shop_id', '=', 'source.shop_id');
      })
      .join('orders as target_order', function joinTargetOrder() {
        this.on('target_order.id', '=', 'target.order_id').andOn('target_order.shop_id', '=', 'target.shop_id');
      })
      .where({ 'source.damaged': true, 'source.type': 'rent', 'target.type': 'rent',
        'source_order.is_deleted': false, 'target_order.is_deleted': false })
      .whereColumn('source.order_id', '<>', 'target.order_id')
      .whereNotIn('target_order.status', ['cancelled', 'returned', 'closed', 'draft'])
      .where('target_order.pickup_date', '>=', today)
      .whereRaw("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(target.stage_flags, '$.delivered')), 'false') NOT IN ('true', '1')")
      .whereRaw("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(target.stage_flags, '$.received')), 'false') NOT IN ('true', '1')")
      .select('source.shop_id', 'source.id as source_item_id', 'source.order_id as source_order_id',
        'source.product_id', 'source.code_snapshot', 'source.name_snapshot',
        'target.id as target_item_id', 'target.order_id as target_order_id',
        'target_order.order_number', 'target_order.pickup_date')
      .orderBy(['source.id', 'target.id']).offset(offset).limit(500);
    if (!affected.length) break;
    const requirements = [];
    const reminders = [];
    for (const row of affected) {
      const reminderId = uuid();
      const label = String(row.code_snapshot || row.name_snapshot || 'Damaged product').slice(0, 255);
      const beforePickup = normalizeSqlDateToIso(addDays(normalizeSqlDateToIso(row.pickup_date), -1));
      requirements.push({
        id: uuid(), shop_id: row.shop_id, source_order_id: row.source_order_id,
        source_order_item_id: row.source_item_id, source_product_id: row.product_id,
        source_product_label: label, target_order_id: row.target_order_id,
        target_order_item_id: row.target_item_id, status: 'pending', reminder_id: reminderId,
      });
      reminders.push({
        id: reminderId, shop_id: row.shop_id, assignee: 'SELF',
        description: `Replacement required: ${label} for Bill ${row.order_number}. Select an alternate product before delivery.`,
        reminder_date: beforePickup < today ? today : beforePickup,
        reminder_time: '9:00 AM', is_completed: false,
      });
    }
    await knex('order_item_replacement_requirements').insert(requirements);
    await knex('reminders').insert(reminders);
  }
}

export async function down(knex) {
  await knex.schema.dropTable('order_item_replacement_requirements');
  await knex.schema.alterTable('order_items', (table) => table.dropColumn('replacement_version'));
}
