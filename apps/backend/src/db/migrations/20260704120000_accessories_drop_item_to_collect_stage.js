/** Remove item_to_collect / pre_check from accessory checklist stage_flags JSON. */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  for (const key of ['item_to_collect', 'pre_check']) {
    const path = `$.${key}`;
    await knex.raw(
      `
      UPDATE \`order_accessories\` AS t
      SET t.stage_flags = JSON_REMOVE(COALESCE(t.stage_flags, JSON_OBJECT()), ?)
      WHERE t.stage_flags IS NOT NULL
        AND JSON_EXTRACT(t.stage_flags, ?) IS NOT NULL
      `,
      [path, path]
    );
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.raw(
    `
    UPDATE \`order_accessories\` AS t
    SET t.stage_flags = JSON_SET(
      COALESCE(t.stage_flags, JSON_OBJECT()),
      '$.item_to_collect',
      false
    )
    WHERE t.stage_flags IS NOT NULL
    `
  );
}
