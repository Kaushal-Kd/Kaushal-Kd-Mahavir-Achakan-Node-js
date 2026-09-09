/**
 * @param {object} source — accessory row from GET /accessories/:id
 * @returns {object} form values for AccessoryFormPage create/duplicate
 */
export function buildAccessoryDuplicateDraft(source) {
  const baseName = String(source?.name || '').trim() || 'Accessory';
  const suffix = ' (Copy)';
  const name = baseName.endsWith(suffix) ? baseName : `${baseName}${suffix}`;

  return {
    name,
    image_url: String(source?.image_url || '').trim(),
    default_type: source?.default_type || 'rent',
    default_order_status: source?.default_order_status || 'regular',
    color: String(source?.color || '').trim(),
    size: String(source?.size || '').trim(),
    qty: Math.max(0, Number(source?.qty) || 0),
    spare_qty: Math.max(0, Number(source?.spare_qty) || 0),
    // A duplicate is fresh stock — damage does not carry over. Set explicitly
    // so the field stays controlled.
    damaged_qty: 0,
    threshold: Math.max(0, Number(source?.threshold ?? 5)),
    unit: String(source?.unit || 'pcs').trim() || 'pcs',
    price_rent: Number(source?.price_rent || 0),
    price_sell: Number(source?.price_sell || 0),
    purchase_price: Number(source?.purchase_price || 0),
    notes: String(source?.notes || '').trim(),
    category_id: source?.category_id || '',
  };
}
