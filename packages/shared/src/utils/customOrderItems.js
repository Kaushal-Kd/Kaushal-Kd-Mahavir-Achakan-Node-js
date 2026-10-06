/**
 * Custom-order product lines. Parent `custom_orders` columns stay a snapshot of the first item.
 */

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
  };
}

/**
 * Prefer saved `items`; otherwise one line from the parent product columns.
 * @param {object} [order]
 * @returns {object[]}
 */
export function customOrderItemsFromOrder(order) {
  const row = order && typeof order === 'object' ? order : {};
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items.map(normalizeCustomOrderItem);
  }
  const fallback = normalizeCustomOrderItem(row);
  const hasAny =
    fallback.design_name ||
    fallback.category_id ||
    fallback.product_name ||
    fallback.color ||
    fallback.size ||
    fallback.linked_product_id;
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
    n.design_name || n.category_id || n.product_name || n.color || n.size || n.linked_product_id
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
