/**
 * Colors are stored in `settings` under `config.colors` as a hand-arranged
 * array — Master → Colors lets a shop reorder them with ↑↓ buttons.
 *
 * Everywhere colors are *picked* they must read alphabetically instead, so a
 * long list is scannable. The master editor keeps its manual order; only the
 * consuming dropdowns sort. Keep this in one place so the six call sites
 * cannot drift apart.
 *
 * @param {string[]|undefined|null} items
 * @returns {string[]} a new sorted array — never mutates the input
 */
export function sortColorsAZ(items) {
  return [...(items || [])].sort((a, b) => String(a).localeCompare(String(b)));
}
