import {
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
  normalizeTime12,
} from '@wrs/shared';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('time_slots', (t) => {
    t.boolean('is_default_delivery').notNullable().defaultTo(false);
    t.boolean('is_default_return').notNullable().defaultTo(false);
  });

  const shops = await knex('shops').select('id');
  for (const { id: shopId } of shops) {
    const slots = await knex('time_slots')
      .where({ shop_id: shopId, is_active: true })
      .select('id', 'time_value', 'is_default_delivery', 'is_default_return');

    let deliveryId = null;
    let returnId = null;
    for (const row of slots) {
      const tv = normalizeTime12(row.time_value);
      if (tv === FALLBACK_DEFAULT_DELIVERY_TIME) deliveryId = row.id;
      if (tv === FALLBACK_DEFAULT_RETURN_TIME) returnId = row.id;
    }

    await knex('time_slots')
      .where({ shop_id: shopId })
      .update({ is_default_delivery: false, is_default_return: false });

    if (deliveryId) {
      await knex('time_slots').where({ id: deliveryId }).update({ is_default_delivery: true });
    }
    if (returnId) {
      await knex('time_slots').where({ id: returnId }).update({ is_default_return: true });
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('time_slots', (t) => {
    t.dropColumn('is_default_delivery');
    t.dropColumn('is_default_return');
  });
}
