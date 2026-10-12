/**
 * Sale create/edit uses date + time. Keep existing calendar days at 00:00:00
 * until a sale is saved again (edit form fills time from created_at).
 */
export async function up(knex) {
  await knex.raw('ALTER TABLE sales MODIFY sale_date DATETIME NOT NULL');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sales MODIFY sale_date DATE NOT NULL');
}
