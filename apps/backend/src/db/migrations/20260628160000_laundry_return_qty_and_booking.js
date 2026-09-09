/**
 * Accessory partial returns + next booking ref on laundry product lines.
 */
export async function up(knex) {
  const hasQtyReturned = await knex.schema.hasColumn('laundry_job_accessories', 'qty_returned');
  if (!hasQtyReturned) {
    await knex.schema.alterTable('laundry_job_accessories', (t) => {
      t.integer('qty_returned').unsigned().notNullable().defaultTo(0);
    });
    await knex('laundry_job_accessories')
      .where({ status: 'returned' })
      .update({ qty_returned: knex.ref('qty') });
  }

  const hasBooking = await knex.schema.hasColumn('laundry_job_products', 'next_booking_no');
  if (!hasBooking) {
    await knex.schema.alterTable('laundry_job_products', (t) => {
      t.string('next_booking_no', 80).nullable();
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('laundry_job_accessories', 'qty_returned')) {
    await knex.schema.alterTable('laundry_job_accessories', (t) => {
      t.dropColumn('qty_returned');
    });
  }
  if (await knex.schema.hasColumn('laundry_job_products', 'next_booking_no')) {
    await knex.schema.alterTable('laundry_job_products', (t) => {
      t.dropColumn('next_booking_no');
    });
  }
}
