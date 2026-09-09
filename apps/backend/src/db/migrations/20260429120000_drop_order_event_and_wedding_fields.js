/**
 * Remove unused booking/customer fields:
 * - orders.event_type
 * - orders.wedding_date
 * - customers.wedding_date
 */
export async function up(knex) {
  const hasOrders = await knex.schema.hasTable('orders');
  if (hasOrders) {
    const hasEventType = await knex.schema.hasColumn('orders', 'event_type');
    const hasWeddingDate = await knex.schema.hasColumn('orders', 'wedding_date');

    if (hasWeddingDate) {
      await knex.schema.alterTable('orders', (t) => {
        t.dropIndex(['shop_id', 'wedding_date']);
      });
    }

    await knex.schema.alterTable('orders', (t) => {
      if (hasEventType) t.dropColumn('event_type');
      if (hasWeddingDate) t.dropColumn('wedding_date');
    });
  }

  const hasCustomers = await knex.schema.hasTable('customers');
  if (hasCustomers) {
    const hasCustomerWedding = await knex.schema.hasColumn('customers', 'wedding_date');
    if (hasCustomerWedding) {
      await knex.schema.alterTable('customers', (t) => {
        t.dropColumn('wedding_date');
      });
    }
  }
}

export async function down(knex) {
  const hasOrders = await knex.schema.hasTable('orders');
  if (hasOrders) {
    const hasEventType = await knex.schema.hasColumn('orders', 'event_type');
    const hasWeddingDate = await knex.schema.hasColumn('orders', 'wedding_date');

    await knex.schema.alterTable('orders', (t) => {
      if (!hasEventType) t.json('event_type').nullable();
      if (!hasWeddingDate) t.date('wedding_date').nullable();
    });

    if (!hasWeddingDate) {
      await knex.schema.alterTable('orders', (t) => {
        t.index(['shop_id', 'wedding_date']);
      });
    }
  }

  const hasCustomers = await knex.schema.hasTable('customers');
  if (hasCustomers) {
    const hasCustomerWedding = await knex.schema.hasColumn('customers', 'wedding_date');
    if (!hasCustomerWedding) {
      await knex.schema.alterTable('customers', (t) => {
        t.date('wedding_date').nullable();
      });
    }
  }
}
