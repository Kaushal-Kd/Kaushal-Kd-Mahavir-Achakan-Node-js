/**
 * Unique accessory remarks for a product line (shown once below that line's accessories).
 *
 * @param {Array<{ remarks?: string | null }>} accessories
 * @returns {string[]}
 */
export function accessoryGroupNotes(accessories) {
  const list = Array.isArray(accessories) ? accessories : [];
  const unique = new Set();
  for (const row of list) {
    const note = String(row?.remarks ?? '').trim();
    if (note) unique.add(note);
  }
  return [...unique];
}