/**
 * Damaged accessory stock held by order lines.
 *
 * `accessories.damaged_qty` is the catalogue-level count of stock written off as
 * damaged, and it is excluded from rentable qty. Order lines are what put stock
 * there: marking a returned rent accessory damaged moves that line's qty out of
 * circulation until someone unmarks it, repairs it, or the line goes away.
 *
 * Keeping the two in step is the whole job of this module, and it is done as a
 * net delta rather than a series of increments so that every route to the same
 * state produces the same number.
 */

/**
 * Catalogue damaged stock held by one order accessory line, or null if it holds
 * none. Sell lines are excluded — a sale has already decremented `qty`.
 *
 * @param {{ damaged?: unknown, type?: string, accessory_id?: string|null, qty?: unknown }|null} line
 * @returns {{ accessoryId: string, qty: number }|null}
 */
export function damagedAccessoryHold(line) {
  if (!line?.damaged && !line?.missing) return null;
  if (String(line.type || 'rent') !== 'rent') return null;
  if (!line.accessory_id) return null;
  const lineQty = Math.max(0, Number(line.qty || 0));
  const damagedQty = line?.damaged
    ? Math.max(0, Number(line.damaged_qty ?? lineQty))
    : Math.max(0, Number(line.damaged_qty || 0));
  const missingQty = line?.missing
    ? Math.max(0, Number(line.missing_qty ?? lineQty))
    : Math.max(0, Number(line.missing_qty || 0));
  const qty = Math.min(lineQty, damagedQty + missingQty);
  return qty > 0 ? { accessoryId: String(line.accessory_id), qty } : null;
}

/**
 * Net change to `damaged_qty` per accessory, given before/after snapshots of
 * order accessory lines.
 *
 * An unchanged line nets to zero, which is what makes it safe to call this on
 * every write: re-saving the same condition, or settling the same order twice,
 * cannot double-count. A line that moves between accessories decrements one and
 * increments the other in the same pass.
 *
 * @param {{ before?: object|null, after?: object|null }[]} pairs
 * @returns {Map<string, number>} accessoryId -> signed change (never zero)
 */
export function damagedAccessoryHoldDelta(pairs) {
  const delta = new Map();
  const bump = (accessoryId, by) => {
    if (!by) return;
    delta.set(accessoryId, (delta.get(accessoryId) || 0) + by);
  };

  for (const { before = null, after = null } of pairs || []) {
    const prev = damagedAccessoryHold(before);
    const next = damagedAccessoryHold(after);
    if (prev) bump(prev.accessoryId, -prev.qty);
    if (next) bump(next.accessoryId, next.qty);
  }

  for (const [accessoryId, change] of [...delta]) {
    if (!change) delta.delete(accessoryId);
  }
  return delta;
}

/**
 * Apply {@link damagedAccessoryHoldDelta} to the accessories table.
 *
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {{ before?: object|null, after?: object|null }[]} pairs
 */
export async function applyDamagedAccessoryHoldDelta(trx, shopId, pairs) {
  const delta = damagedAccessoryHoldDelta(pairs);

  for (const [accessoryId, change] of delta) {
    const target = trx('accessories').where({ id: accessoryId, shop_id: shopId });
    if (change > 0) {
      await target.increment('damaged_qty', change);
    } else {
      // Floored: lines damaged before this feature existed were never counted
      // up, so releasing them must not push the column negative.
      await target.update({
        damaged_qty: trx.raw('GREATEST(0, COALESCE(damaged_qty, 0) - ?)', [-change]),
      });
    }
  }
}
