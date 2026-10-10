/**
 * Custom-order product lines. Parent `custom_orders` columns stay a snapshot of the first item
 * (plus earliest trial / any-given-to-tailor for list and reminders).
 */

/**
 * @returns {object}
 */
export function emptyCustomOrderItemWorkshop() {
  return {
    measurements: {},
    given_to_tailor: false,
    tailor_name: '',
    tailor_date: '',
    trial_date: '',
    trial_product: '',
    retrials: [],
    design_images: [],
    trial_images: [],
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asSqlDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asMeasurements(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/**
 * @param {unknown} value
 * @returns {Array<{ date: string, notes: string }>}
 */
function asRetrials(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      date: asSqlDate(row.date),
      notes: row.notes != null ? String(row.notes) : '',
    }));
}

/**
 * @param {object} [src]
 * @returns {object}
 */
export function normalizeCustomOrderItemWorkshop(src) {
  const row = src && typeof src === 'object' ? src : {};
  return {
    measurements: asMeasurements(row.measurements),
    given_to_tailor: !!row.given_to_tailor,
    tailor_name: String(row.tailor_name || '').trim(),
    tailor_date: asSqlDate(row.tailor_date),
    trial_date: asSqlDate(row.trial_date),
    trial_product: String(row.trial_product || '').trim(),
    retrials: asRetrials(row.retrials),
    design_images: asStringArray(row.design_images),
    trial_images: asStringArray(row.trial_images),
  };
}

/**
 * @param {object} [src]
 * @returns {boolean}
 */
export function customOrderItemHasWorkshopData(src) {
  const w = normalizeCustomOrderItemWorkshop(src);
  return Boolean(
    Object.values(w.measurements).some((v) => String(v ?? '').trim()) ||
      w.given_to_tailor ||
      w.tailor_name ||
      w.tailor_date ||
      w.trial_date ||
      w.trial_product ||
      w.retrials.some((row) => row.date) ||
      w.design_images.length ||
      w.trial_images.length
  );
}

/**
 * Parent-order snapshot: first item's measurements/images, any given-to-tailor, earliest trial.
 * @param {object[]} [items]
 * @returns {object}
 */
export function aggregateCustomOrderWorkshop(items) {
  const list = (items || []).map(normalizeCustomOrderItemWorkshop);
  const first = list[0] || emptyCustomOrderItemWorkshop();
  const tailorSrc = list.find((item) => item.given_to_tailor) || first;
  let earliestTrial = first.trial_date || '';
  for (const item of list) {
    if (item.trial_date && (!earliestTrial || item.trial_date < earliestTrial)) {
      earliestTrial = item.trial_date;
    }
  }
  return {
    measurements: first.measurements,
    given_to_tailor: list.some((item) => item.given_to_tailor),
    tailor_name: tailorSrc.tailor_name,
    tailor_date: tailorSrc.tailor_date,
    trial_date: earliestTrial,
    trial_product: first.trial_product,
    retrials: first.retrials,
    design_images: first.design_images,
    trial_images: first.trial_images,
  };
}

/**
 * @returns {object}
 */
export function emptyCustomOrderItem() {
  return {
    id: null,
    design_name: '',
    category_id: '',
    product_name: '',
    color: '',
    size: '',
    linked_product_id: null,
    generated_product_code: null,
    ...emptyCustomOrderItemWorkshop(),
  };
}

/**
 * @param {object} [row]
 * @returns {object}
 */
export function normalizeCustomOrderItem(row) {
  const src = row && typeof row === 'object' ? row : {};
  return {
    id: src.id || null,
    design_name: String(src.design_name || '').trim(),
    category_id: src.category_id || '',
    product_name: String(src.product_name || '').trim(),
    color: String(src.color || '').trim(),
    size: String(src.size || '').trim(),
    linked_product_id: src.linked_product_id || null,
    generated_product_code: src.generated_product_code || null,
    ...normalizeCustomOrderItemWorkshop(src),
  };
}

/**
 * Prefer saved `items`; otherwise one line from the parent product columns.
 * First item inherits order-level workshop fields when it has none (legacy rows).
 * @param {object} [order]
 * @returns {object[]}
 */
export function customOrderItemsFromOrder(order) {
  const row = order && typeof order === 'object' ? order : {};
  const parentWorkshop = normalizeCustomOrderItemWorkshop(row);
  const parentHasWorkshop = customOrderItemHasWorkshopData(row);
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items.map((item, index) => {
      const n = normalizeCustomOrderItem(item);
      if (index === 0 && !customOrderItemHasWorkshopData(item) && parentHasWorkshop) {
        return { ...n, ...parentWorkshop };
      }
      return n;
    });
  }
  const fallback = normalizeCustomOrderItem({ ...row, ...parentWorkshop });
  const hasAny =
    fallback.design_name ||
    fallback.category_id ||
    fallback.product_name ||
    fallback.color ||
    fallback.size ||
    fallback.linked_product_id ||
    parentHasWorkshop;
  return hasAny ? [fallback] : [emptyCustomOrderItem()];
}

/**
 * Snapshot of the first product onto the parent custom-order columns.
 * @param {object[]} items
 */
export function primaryCustomOrderItemFields(items) {
  const first = normalizeCustomOrderItem((items || [])[0]);
  return {
    design_name: first.design_name || null,
    category_id: first.category_id || null,
    product_name: first.product_name || null,
    color: first.color || null,
    size: first.size || null,
    linked_product_id: first.linked_product_id || null,
    generated_product_code: first.generated_product_code || null,
  };
}

/**
 * List / draft label for one or more products.
 * @param {object} [order]
 * @returns {string}
 */
export function formatCustomOrderProductsLabel(order) {
  const items = customOrderItemsFromOrder(order).filter(
    (item) => item.product_name || item.design_name
  );
  if (!items.length) return '';
  return items
    .map((item) => item.product_name || item.design_name)
    .filter(Boolean)
    .join(', ');
}

/**
 * @param {object} [item]
 * @returns {boolean}
 */
export function isCustomOrderItemFilled(item) {
  const n = normalizeCustomOrderItem(item);
  return Boolean(
    n.design_name ||
      n.category_id ||
      n.product_name ||
      n.color ||
      n.size ||
      n.linked_product_id ||
      customOrderItemHasWorkshopData(item)
  );
}

/**
 * First product line that still needs an inventory product.
 * @param {object} [order]
 * @returns {object|null}
 */
export function nextUnlinkedCustomOrderItem(order) {
  return (
    customOrderItemsFromOrder(order).find(
      (item) => !item.linked_product_id && isCustomOrderItemFilled(item)
    ) || null
  );
}

/**
 * @param {object} [order]
 * @returns {boolean}
 */
export function customOrderHasLinkedProduct(order) {
  if (order?.linked_product_id) return true;
  return customOrderItemsFromOrder(order).some((item) => item.linked_product_id);
}

/**
 * Inventory product ids on this custom order (first item first).
 * @param {object} [order]
 * @returns {string[]}
 */
export function customOrderLinkedProductIds(order) {
  const ids = [];
  for (const item of customOrderItemsFromOrder(order)) {
    if (item.linked_product_id) ids.push(String(item.linked_product_id));
  }
  const parent = order?.linked_product_id ? String(order.linked_product_id) : '';
  if (parent && !ids.includes(parent)) ids.unshift(parent);
  return [...new Set(ids)];
}

/**
 * @param {object} [order]
 * @param {Array<{ id?: string, label?: string, unit?: string }>} [fieldDefs]
 * @returns {string}
 */
export function formatCustomOrderMeasurementsSummary(order, fieldDefs = []) {
  const items = customOrderItemsFromOrder(order);
  const parts = [];
  items.forEach((item, index) => {
    const measurements =
      item.measurements && typeof item.measurements === 'object' ? item.measurements : {};
    const lines = [];
    for (const def of fieldDefs) {
      const val = measurements[def.id];
      const s = String(val ?? '').trim();
      if (!s) continue;
      lines.push(`${def.label}: ${s}${def.unit ? ` ${def.unit}` : ''}`);
    }
    if (!lines.length) return;
    const label = item.product_name || item.design_name || `Product ${index + 1}`;
    parts.push(items.length > 1 ? `${label} — ${lines.join('; ')}` : lines.join('; '));
  });
  return parts.join('\n');
}
