import { normalizeProductName } from './productCodeFormat.js';

/**
 * @param {object} source — product row from GET /products/:id
 * @returns {object} form values for ProductFormPage create/duplicate
 */
export function buildProductDuplicateDraft(source) {
  const baseName = normalizeProductName(String(source?.name || '').trim()) || 'Product';
  const suffix = ' (Copy)';
  const name = baseName.endsWith(suffix) ? baseName : `${baseName}${suffix}`;

  return {
    name,
    code: '',
    type: source?.type || 'rent',
    category_id: source?.category_id || '',
    size: source?.size || '',
    color: source?.color || '',
    price_rent: Number(source?.price_rent || 0),
    price_sell: Number(source?.price_sell || 0),
    qty: Math.max(0, Number(source?.qty) || 1),
    lifetime_gap: Math.max(0, Number(source?.lifetime_gap) || 0),
    count: 0,
    status: 'available',
    notes: String(source?.notes || '').trim(),
    main_image: String(source?.main_image || '').trim(),
    photos: Array.isArray(source?.photos) ? source.photos.filter(Boolean) : [],
  };
}

/**
 * @param {Array<object>} rows — accessory mapping rows from GET /products/:id/accessory-mapping
 * @returns {Array<{ accessory_id: string, is_recommended: boolean, is_required: boolean, display_order: number }>}
 */
export function normalizeAccessoryMappingsForDuplicate(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r, index) => ({
      accessory_id: String(r?.accessory_id || '').trim(),
      is_recommended: r?.is_recommended !== false,
      is_required: !!r?.is_required,
      display_order: Number(r?.display_order ?? index) || index,
    }))
    .filter((r) => r.accessory_id);
}
