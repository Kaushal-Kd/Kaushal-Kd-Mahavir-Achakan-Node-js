import { accessoriesApi } from './api/accessories.js';
import { deselectAccessoryRow } from './bookingAccessoryCart.js';
import { formatAccessoryQtyExceededMessage, formatAccessorySpareMessage } from '@wrs/shared';

/**
 * @param {object} opts
 * @param {string} opts.accessoryId
 * @param {string} opts.from YYYY-MM-DD
 * @param {string} opts.to YYYY-MM-DD
 * @param {number} opts.qty
 * @param {string} [opts.excludeOrderId]
 * @param {string} [opts.label] for error messages
 * @returns {Promise<{ ok: boolean, freeQty: number, requestedQty: number, message: string, data?: object }>}
 */
export async function validateRentAccessoryQty(opts) {
  const { accessoryId, from, to, qty, excludeOrderId, label = 'Accessory' } = opts;

  const requestedQty = Math.max(1, Number(qty) || 1);
  if (!from || !to) {
    return {
      ok: false,
      freeQty: 0,
      requestedQty,
      message: 'Delivery and return dates are required',
    };
  }
  if (!accessoryId) {
    return {
      ok: false,
      freeQty: 0,
      requestedQty,
      message: 'Accessory is required',
    };
  }

  try {
    const res = await accessoriesApi.checkAvailability({
      accessory_id: accessoryId,
      from,
      to,
      qty: requestedQty,
      ...(excludeOrderId ? { exclude_order_id: excludeOrderId } : {}),
    });
    const data = res?.data || res || {};
    const freeQty = Number(data.free_qty || 0);
    const spareQty = Number(data.spare_qty || 0);
    const damagedQty = Number(data.damaged_qty || 0);
    const available = data.available !== false && freeQty >= requestedQty;
    if (available) {
      return {
        ok: true,
        freeQty,
        spareQty,
        damagedQty,
        requestedQty,
        message: '',
        data,
      };
    }
    const message =
      freeQty > 0
        ? formatAccessoryQtyExceededMessage(
            label,
            requestedQty,
            freeQty,
            spareQty,
            'rent',
            damagedQty
          )
        : formatAccessorySpareMessage(label, spareQty, freeQty, 'rent', damagedQty);
    return {
      ok: false,
      freeQty,
      spareQty,
      damagedQty,
      requestedQty,
      message,
      data,
    };
  } catch (err) {
    const message =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.message ||
      `Could not check availability for ${label}`;
    return {
      ok: false,
      freeQty: 0,
      requestedQty,
      message,
    };
  }
}

function isRentAccessoryRow(row) {
  if (!row) return false;
  if (row.line_kind === 'standalone_accessory') {
    return String(row.type || 'rent').toLowerCase() !== 'sell';
  }
  return !!row.selected && String(row.type || 'rent').toLowerCase() !== 'sell';
}

/** Rent catalog row on a product line (recommended/mapped), selected or not. */
function isRentAccessoryCatalogRow(row) {
  if (!row?.accessory_id) return false;
  return String(row.type || 'rent').toLowerCase() !== 'sell';
}

function shouldDeselectSelectedAccessory(acc, merged, { grandfatherPersisted }) {
  if (!acc?.selected) return false;
  if (grandfatherPersisted && acc.persisted_id) return false;
  const qty = Math.max(1, Number(merged.qty ?? acc.qty) || 1);
  const free = Math.max(0, Number(merged.free_qty ?? 0));
  return free < qty;
}

/**
 * Refresh free_qty / booked_qty / total_qty on rent accessory lines from the API.
 * @param {object[]} lines
 * @param {{ from: string, to: string, excludeOrderId?: string }} window
 * @param {{ grandfatherPersisted?: boolean }} [options]
 * @returns {Promise<{ lines: object[], deselectedNames: string[] }>}
 */
export async function refreshRentAccessoryLinesAvailability(lines, window, options = {}) {
  const { from, to, excludeOrderId } = window;
  const { grandfatherPersisted = false } = options;
  if (!from || !to || !Array.isArray(lines) || lines.length === 0) {
    return { lines, deselectedNames: [] };
  }

  const accessoryIds = new Set();
  for (const line of lines) {
    if (line.line_kind === 'standalone_accessory' && isRentAccessoryRow(line)) {
      if (line.accessory_id) accessoryIds.add(String(line.accessory_id));
    }
    for (const acc of line.accessories || []) {
      if (isRentAccessoryCatalogRow(acc) && acc.accessory_id) {
        accessoryIds.add(String(acc.accessory_id));
      }
    }
  }
  if (accessoryIds.size === 0) return { lines, deselectedNames: [] };

  const availabilityById = new Map();
  await Promise.all(
    [...accessoryIds].map(async (accessoryId) => {
      const result = await validateRentAccessoryQty({
        accessoryId,
        from,
        to,
        qty: 1,
        excludeOrderId,
        label: 'Accessory',
      });
      const data = result.data || {};
      availabilityById.set(accessoryId, {
        total_qty: Number(data.total_qty ?? 0),
        spare_qty: Number(data.spare_qty ?? 0),
        damaged_qty: Number(data.damaged_qty ?? 0),
        rentable_qty: Number(data.rentable_qty ?? 0),
        booked_qty: Number(data.booked_qty ?? 0),
        washing_qty: Number(data.washing_qty ?? 0),
        washing_queue_qty: Number(data.washing_queue_qty ?? 0),
        laundry_washing_qty: Number(data.laundry_washing_qty ?? 0),
        free_qty: Number(data.free_qty ?? result.freeQty ?? 0),
      });
    })
  );

  const deselectedNames = [];

  const updatedLines = lines.map((line) => {
    if (line.line_kind === 'standalone_accessory' && isRentAccessoryRow(line)) {
      const meta = availabilityById.get(String(line.accessory_id || ''));
      if (!meta) return line;
      return { ...line, ...meta };
    }
    if (!(line.accessories || []).length) return line;
    return {
      ...line,
      accessories: (line.accessories || []).map((acc) => {
        if (!isRentAccessoryCatalogRow(acc)) return acc;
        const meta = availabilityById.get(String(acc.accessory_id || ''));
        if (!meta) return acc;
        const merged = { ...acc, ...meta };
        if (shouldDeselectSelectedAccessory(acc, merged, { grandfatherPersisted })) {
          deselectedNames.push(String(acc.name_snapshot || 'Accessory').trim() || 'Accessory');
          return deselectAccessoryRow(merged);
        }
        return merged;
      }),
    };
  });

  return { lines: updatedLines, deselectedNames };
}
