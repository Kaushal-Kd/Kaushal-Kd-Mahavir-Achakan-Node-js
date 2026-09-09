/**
 * One-time alphabetical normalisation of each shop's colour list.
 *
 * Colours are stored as a JSON array in `settings` under `config.colors` in
 * whatever order the admin arranged them. The dropdowns that consume the list
 * now render it A–Z, so the master editor was showing a different order to the
 * rest of the app.
 *
 * This sorts the stored order **once**. It deliberately does not run on every
 * load: the editor's ↑↓ arrows must stay meaningful, and a repeated forced sort
 * would silently undo every manual move. From here on the list only changes
 * when the admin changes it (new values insert alphabetically, arrows persist).
 *
 * Sizes / units / tailors are left alone — S, M, L is intentionally not
 * alphabetical.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const rows = await knex('settings').where({ key: 'config.colors' }).select('id', 'value');

  for (const row of rows) {
    let items;
    try {
      items = JSON.parse(row.value);
    } catch {
      continue; // Unparseable — leave exactly as found.
    }
    if (!Array.isArray(items) || items.length < 2) continue;

    const sorted = [...items].sort((a, b) => String(a).localeCompare(String(b)));
    if (JSON.stringify(sorted) === JSON.stringify(items)) continue;

    await knex('settings').where({ id: row.id }).update({ value: JSON.stringify(sorted) });
  }
}

/**
 * No-op: the original arbitrary order is not recoverable, and re-shuffling on
 * rollback would be worse than leaving the list sorted.
 */
export async function down() {}
