/**
 * Build a partial customer update from booking form values vs stored customer row.
 * @param {object} detailRow — customer from API
 * @param {{ name?: string, phone1?: string, phone2?: string|null, phone2_name?: string|null, whatsapp?: string|null, address?: string|null }} next
 * @returns {Record<string, string|null>}
 */
export function buildCustomerContactPatch(detailRow, next) {
  const row = detailRow || {};
  const patch = {};
  if ((row.name || '') !== (next.name || '')) patch.name = next.name;
  if ((row.phone1 || '') !== (next.phone1 || '')) patch.phone1 = next.phone1;
  if ((row.phone2 || '') !== (next.phone2 || '')) patch.phone2 = next.phone2 ?? null;
  if (String(row.phone2_name || '').trim() !== String(next.phone2_name || '').trim()) {
    patch.phone2_name = next.phone2_name ?? null;
  }
  if ((String(row.whatsapp || '').trim() || '') !== (String(next.whatsapp || '').trim() || '')) {
    patch.whatsapp = next.whatsapp ?? null;
  }
  if ((row.address || '') !== (next.address || '')) patch.address = next.address ?? null;
  return patch;
}
