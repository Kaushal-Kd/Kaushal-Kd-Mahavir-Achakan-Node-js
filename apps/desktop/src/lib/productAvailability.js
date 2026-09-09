import { productsApi } from './api/products.js';

/**
 * @param {object} opts
 * @param {string} [opts.productId]
 * @param {string} [opts.code]
 * @param {string} opts.from YYYY-MM-DD
 * @param {string} opts.to YYYY-MM-DD
 * @param {number} opts.qty
 * @param {string} [opts.excludeOrderId]
 * @param {string} [opts.label] for error messages
 * @returns {Promise<{ ok: boolean, freeQty: number, requestedQty: number, message: string, data?: object }>}
 */
export async function validateRentProductQty(opts) {
  const {
    productId,
    code,
    from,
    to,
    qty,
    excludeOrderId,
    label = 'Product',
    lite = false,
  } = opts;

  const requestedQty = Math.max(1, Number(qty) || 1);
  if (!from || !to) {
    return {
      ok: false,
      freeQty: 0,
      requestedQty,
      message: 'Delivery and return dates are required',
    };
  }
  if (!productId && !code) {
    return {
      ok: false,
      freeQty: 0,
      requestedQty,
      message: 'Product is required',
    };
  }

  try {
    const res = await productsApi.checkAvailability({
      ...(productId ? { product_id: productId } : {}),
      ...(code ? { code } : {}),
      from,
      to,
      qty: requestedQty,
      ...(excludeOrderId ? { exclude_order_id: excludeOrderId } : {}),
      ...(lite ? { include_upcoming: false } : {}),
    });
    const data = res?.data || res || {};
    const freeQty = Number(data.free_qty || 0);
    const productStatus = String(data.product?.status || '').toLowerCase();
    if (productStatus === 'sold') {
      return {
        ok: false,
        freeQty,
        requestedQty,
        message: `${label} cannot be booked for rent because it is sold`,
        data,
      };
    }
    const available = data.available !== false && freeQty >= requestedQty;
    if (available) {
      return {
        ok: true,
        freeQty,
        requestedQty,
        message: '',
        data,
      };
    }
    const message =
      freeQty > 0
        ? `${label}: requested ${requestedQty}, only ${freeQty} available for selected dates`
        : `${label} is not available for selected dates`;
    return {
      ok: false,
      freeQty,
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

/**
 * @param {object} opts
 * @param {string} opts.productId
 * @param {string} [opts.excludeOrderId]
 * @param {string} [opts.label]
 * @returns {Promise<{ ok: boolean, message: string, data?: object }>}
 */
export async function validateSellProductQty(opts) {
  const { productId, excludeOrderId, label = 'Product' } = opts;
  if (!productId) {
    return { ok: false, message: 'Product is required' };
  }

  try {
    const res = await productsApi.checkSellAvailability({
      product_id: productId,
      ...(excludeOrderId ? { exclude_order_id: excludeOrderId } : {}),
    });
    const data = res?.data || res || {};
    if (data.available !== false) {
      return { ok: true, message: '', data };
    }
    return {
      ok: false,
      message: data.message || `${label} cannot be sold because it is already booked`,
      data,
    };
  } catch (err) {
    const message =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.message ||
      `Could not check sell availability for ${label}`;
    return { ok: false, message };
  }
}

/** @param {string} label */
export function reconcileSoldProductMessage(label) {
  return `${label} is already sold — this cancelled booking cannot be reconciled`;
}

/**
 * Check whether any product lines on a cancelled booking were sold after cancel.
 * @param {object[]} lines — booking form lines
 * @returns {Promise<{ ok: boolean, blocked: Array<{ productId: string, label: string, reason: string }>, message: string }>}
 */
export async function validateReconcileProductLines(lines) {
  const blocked = [];
  const seen = new Set();
  const productLines = (lines || []).filter(
    (line) => line.line_kind !== 'standalone_accessory' && line.product_id
  );

  await Promise.all(
    productLines.map(async (line) => {
      const productId = String(line.product_id);
      if (seen.has(productId)) return;
      seen.add(productId);
      const fallbackLabel = line.name_snapshot || line.code_snapshot || 'Product';
      try {
        const res = await productsApi.get(productId);
        const product = res?.data || res || {};
        if (String(product.status || '').toLowerCase() === 'sold') {
          const label = product.name || product.code || fallbackLabel;
          blocked.push({
            productId,
            label,
            reason: reconcileSoldProductMessage(label),
          });
        }
      } catch {
        /* ignore per-product fetch errors; submit still validated on server */
      }
    })
  );

  if (blocked.length === 0) {
    return { ok: true, blocked: [], message: '' };
  }
  return {
    ok: false,
    blocked,
    message: blocked.map((entry) => entry.reason).join('; '),
  };
}

/**
 * Refresh free_qty / booked_qty / total_qty on rent product lines from the API.
 * @param {object[]} lines
 * @param {{ from: string, to: string, excludeOrderId?: string }} window
 * @returns {Promise<object[]>}
 */
export async function refreshRentLinesAvailability(lines, window) {
  const { from, to, excludeOrderId } = window;
  if (!from || !to || !Array.isArray(lines) || lines.length === 0) return lines;

  const updated = await Promise.all(
    lines.map(async (line) => {
      if (line.line_kind === 'standalone_accessory') return line;
      if (String(line.type || 'rent').toLowerCase() === 'sell') return line;
      if (!line.product_id) return line;

      const lineQty = Math.max(1, Number(line.qty) || 1);
      const result = await validateRentProductQty({
        productId: line.product_id,
        from,
        to,
        qty: lineQty,
        excludeOrderId,
        label: line.name_snapshot || line.code_snapshot || 'Product',
      });
      const data = result.data || {};
      return {
        ...line,
        total_qty: Number(data.total_qty ?? line.total_qty ?? 0),
        booked_qty: Number(data.booked_qty ?? line.booked_qty ?? 0),
        free_qty: result.ok ? result.freeQty : Number(data.free_qty ?? line.free_qty ?? 0),
        washing_qty: Number(data.washing_qty ?? line.washing_qty ?? 0),
      };
    })
  );
  return updated;
}
