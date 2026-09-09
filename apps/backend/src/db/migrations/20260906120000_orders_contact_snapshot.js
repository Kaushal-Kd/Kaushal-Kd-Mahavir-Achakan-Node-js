/**
 * Denormalize booking contact No.1 + address on orders for reliable edit hydration.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasPhone = await knex.schema.hasColumn('orders', 'contact_phone1');
  if (!hasPhone) {
    await knex.schema.alterTable('orders', (t) => {
      t.string('contact_phone1', 30).nullable();
      t.text('contact_address').nullable();
    });
  }

  await knex.raw(`
    UPDATE orders o
    INNER JOIN customers c ON c.id = o.customer_id AND c.shop_id = o.shop_id
    SET
      o.contact_phone1 = COALESCE(NULLIF(TRIM(o.contact_phone1), ''), NULLIF(TRIM(c.phone1), '')),
      o.contact_address = COALESCE(NULLIF(TRIM(o.contact_address), ''), NULLIF(TRIM(c.address), ''))
    WHERE o.customer_id IS NOT NULL
  `);

  const ordersNeeding = await knex('orders')
    .where(function whereEmptyContact() {
      this.whereNull('contact_phone1')
        .orWhere('contact_phone1', '')
        .orWhereNull('contact_address')
        .orWhere('contact_address', '');
    })
    .select('id', 'shop_id', 'contact_phone1', 'contact_address');

  for (const order of ordersNeeding) {
    const log = await knex('system_logs')
      .where({ shop_id: order.shop_id, entity_id: order.id, module: 'booking' })
      .orderBy('created_at', 'asc')
      .first('bill_data');

    if (!log?.bill_data) continue;

    let billData = log.bill_data;
    if (typeof billData === 'string') {
      try {
        billData = JSON.parse(billData);
      } catch {
        continue;
      }
    }

    const cust = billData?.customer;
    if (!cust || typeof cust !== 'object') continue;

    const patch = {};
    const phone = String(cust.phone1 || cust.phone || '').trim();
    const addr = String(cust.address || '').trim();

    if (!String(order.contact_phone1 || '').trim() && phone) {
      patch.contact_phone1 = phone.slice(0, 30);
    }
    if (!String(order.contact_address || '').trim() && addr) {
      patch.contact_address = addr;
    }

    if (Object.keys(patch).length > 0) {
      await knex('orders').where({ id: order.id }).update(patch);
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasPhone = await knex.schema.hasColumn('orders', 'contact_phone1');
  if (hasPhone) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('contact_phone1');
      t.dropColumn('contact_address');
    });
  }
}
