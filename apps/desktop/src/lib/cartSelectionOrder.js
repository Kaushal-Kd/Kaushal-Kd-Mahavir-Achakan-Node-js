/**
 * Order in which the user put lines into the cart (oldest first). The cart UI shows
 * newest first, but a booking must keep the user's selection sequence.
 * @param {object[]} rows
 */
export function sortCartLinesBySelectionOrder(rows) {
  const t = (line) => {
    const v = new Date(line?.created_at || 0).getTime();
    return Number.isFinite(v) ? v : 0;
  };
  return (rows || [])
    .map((line, index) => ({ line, index }))
    .sort((a, b) => t(a.line) - t(b.line) || b.index - a.index)
    .map(({ line }) => line);
}
