/**
 * Category pickers and the Master → Categories table both read A–Z by name.
 * Manual sort_order is ignored so product and accessory lists stay scannable.
 *
 * @param {{ label?: string }[]|undefined|null} items
 * @returns {{ label?: string }[]}
 */
export function sortCategoriesAZ(items) {
  return [...(items || [])].sort((a, b) =>
    String(a?.label || '').localeCompare(String(b?.label || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  );
}
