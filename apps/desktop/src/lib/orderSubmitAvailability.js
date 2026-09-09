import { isRentAccessoryLine } from './bookingAccessoryCart.js';
import { validateRentAccessoryQty } from './accessoryAvailability.js';
import { validateRentProductQty } from './productAvailability.js';

/**
 * Aggregate rent accessory demand from booking lines (same rules as CreateOrder submit).
 * @param {object[]} lines
 * @returns {{ demand: Map<string, number>, labels: Map<string, string> }}
 */
export function collectRentAccessoryDemand(lines) {
  const demand = new Map();
  const labels = new Map();

  for (const line of lines) {
    if (line.line_kind === 'standalone_accessory' && isRentAccessoryLine(line)) {
      const id = String(line.accessory_id || '');
      if (!id) continue;
      const qty = Math.max(1, Number(line.qty) || 1);
      demand.set(id, (demand.get(id) || 0) + qty);
      if (!labels.has(id)) {
        labels.set(id, line.name_snapshot || 'Accessory');
      }
      continue;
    }
    for (const acc of line.accessories || []) {
      if (!acc.selected || !isRentAccessoryLine(acc)) continue;
      const id = String(acc.accessory_id || '');
      if (!id) continue;
      const qty = Math.max(1, Number(acc.qty) || 1);
      demand.set(id, (demand.get(id) || 0) + qty);
      if (!labels.has(id)) {
        labels.set(id, acc.name_snapshot || 'Accessory');
      }
    }
  }

  return { demand, labels };
}

/**
 * Validate rent product + accessory availability for order submit (parallel API calls).
 * @param {object[]} lines
 * @param {{ from: string, to: string, excludeOrderId?: string }} window
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function validateOrderRentAvailability(lines, window) {
  const { from, to, excludeOrderId } = window;
  const checks = [];

  for (const line of lines) {
    if (line.line_kind === 'standalone_accessory') continue;
    if (String(line.type || 'rent').toLowerCase() === 'sell') continue;
    if (!line.product_id) continue;
    checks.push(
      validateRentProductQty({
        productId: line.product_id,
        from,
        to,
        qty: Math.max(1, Number(line.qty) || 1),
        excludeOrderId,
        label: line.name_snapshot || line.code_snapshot || 'Product',
        lite: true,
      })
    );
  }

  const { demand, labels } = collectRentAccessoryDemand(lines);
  for (const [accessoryId, qty] of demand) {
    checks.push(
      validateRentAccessoryQty({
        accessoryId,
        from,
        to,
        qty,
        excludeOrderId,
        label: labels.get(accessoryId) || 'Accessory',
      })
    );
  }

  if (checks.length === 0) return { ok: true };

  const results = await Promise.all(checks);
  const failed = results.find((r) => !r.ok);
  if (failed) return { ok: false, message: failed.message };
  return { ok: true };
}
