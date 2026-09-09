import { draftsApi } from './api/drafts.js';
import { validateRentProductQty } from './productAvailability.js';

export const AVAILABILITY_CART_DRAFT_KIND = 'availability_cart';

/** @param {object} line */
export function cartLineSortTime(line) {
  const raw = line?.updated_at || line?.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest cart activity first (new lines and recent qty updates). */
export function sortCartLinesNewestFirst(rows) {
  return [...(rows || [])].sort((a, b) => cartLineSortTime(b) - cartLineSortTime(a));
}

/** @param {object} draft */
export function draftToCartLine(draft) {
  const data = draft?.data || {};
  return {
    ...data,
    id: draft.id,
    draft_id: draft.id,
    added_by_id: draft.user_id,
    added_by_name: draft.user_name || null,
    added_by_email: draft.user_email || null,
    added_by_avatar: null,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  };
}

/** @param {object} line */
export function stripAvailabilityCartDraftMeta(line) {
  const {
    id: _id,
    draft_id: _draftId,
    added_by_id: _addedById,
    added_by_name: _addedByName,
    added_by_email: _addedByEmail,
    added_by_avatar: _addedByAvatar,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...rest
  } = line;
  return rest;
}

/**
 * @param {object} opts
 * @param {object[]} opts.cart
 * @param {object} opts.customer
 * @param {object} opts.product
 * @param {string} opts.from
 * @param {string} opts.to
 * @param {number} opts.qty
 * @param {string|null} opts.deliveryTime
 * @param {string|null} opts.returnTime
 */
export async function addProductToAvailabilityCart(opts) {
  const {
    cart,
    customer,
    product,
    from,
    to,
    qty,
    deliveryTime,
    returnTime,
  } = opts;

  const requestedQty = Math.max(1, Number(qty) || 1);
  const label = product.name || product.code || 'Product';

  const existingIdx = cart.findIndex(
    (c) =>
      c.customer_id === customer.id &&
      c.product_id === product.id &&
      c.from === from &&
      c.to === to
  );

  if (existingIdx !== -1) {
    const merged = cart[existingIdx];
    const nextQty = Number(merged.qty || 0) + requestedQty;
    const stockCheck = await validateRentProductQty({
      productId: product.id,
      code: product.code,
      from,
      to,
      qty: nextQty,
      label,
    });
    if (!stockCheck.ok) {
      throw new Error(stockCheck.message);
    }
    const updatedData = { ...stripAvailabilityCartDraftMeta(merged), qty: nextQty };
    const res = await draftsApi.update(merged.draft_id, {
      kind: AVAILABILITY_CART_DRAFT_KIND,
      data: updatedData,
      title: `${updatedData.customer_name} · ${updatedData.name}`,
    });
    return draftToCartLine(res?.data || res);
  }

  const stockCheck = await validateRentProductQty({
    productId: product.id,
    code: product.code,
    from,
    to,
    qty: requestedQty,
    label,
  });
  if (!stockCheck.ok) {
    throw new Error(stockCheck.message);
  }

  const lineData = {
    product_id: product.id,
    category_id: product.category_id || null,
    code: product.code,
    name: product.name,
    main_image: product.main_image,
    price_rent: product.price_rent,
    qty: requestedQty,
    from,
    to,
    delivery_time: deliveryTime || null,
    return_time: returnTime || null,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.phone1 || null,
    accessories: [],
    tailor_notes: '',
    tailor_note_image: '',
  };
  const res = await draftsApi.create({
    kind: AVAILABILITY_CART_DRAFT_KIND,
    data: lineData,
    title: `${lineData.customer_name} · ${lineData.name}`,
  });
  return draftToCartLine(res?.data || res);
}
