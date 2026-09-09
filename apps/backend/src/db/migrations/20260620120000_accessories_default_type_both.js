/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE accessories
    MODIFY COLUMN default_type ENUM('rent', 'sell', 'both') NOT NULL DEFAULT 'sell'
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(`
    UPDATE accessories
    SET default_type = 'sell'
    WHERE default_type = 'both'
  `);
  await knex.raw(`
    ALTER TABLE accessories
    MODIFY COLUMN default_type ENUM('rent', 'sell') NOT NULL DEFAULT 'sell'
  `);
}
