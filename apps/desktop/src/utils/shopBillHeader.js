import { api, unwrap } from '../lib/api.js';
import { useShopStore } from '../stores/shopStore.js';

export const DEFAULT_BILL_SHOP = {
  name: '',
  address: '',
  phone: '',
  logoUrl: '',
};

/** Build a single-line postal address from a shops table row. */
export function formatShopAddress(shop) {
  if (!shop) return '';
  return [shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
}

/** Normalize API / store shop row for bill header and receipts. */
export function mapShopForBill(shop) {
  if (!shop) return { ...DEFAULT_BILL_SHOP };
  return {
    name: shop.shop_name || shop.name || '',
    address: formatShopAddress(shop),
    phone: shop.phone || '',
    logoUrl: shop.logo_url || '',
  };
}

function shopFromStore(shopId) {
  const { shops, selectedShopId } = useShopStore.getState();
  const id = shopId || selectedShopId;
  if (!id) return null;
  return shops.find((s) => s.id === id) || null;
}

/**
 * Shop header for bills: prefers a fresh GET /shops/:id for the currently
 * selected shop, then falls back to the persisted shop list.
 */
export async function resolveBillShopHeader(shopId) {
  const id = shopId || useShopStore.getState().selectedShopId;
  if (!id) return { ...DEFAULT_BILL_SHOP };

  try {
    const res = await api.get(`/shops/${id}`);
    const row = unwrap(res)?.data;
    if (row) return mapShopForBill(row);
  } catch {
    /* use cached shop */
  }

  return mapShopForBill(shopFromStore(id));
}

/** Apply shop logo when the bill template has no logo configured. */
/** Window / PDF title for print (avoids app page title in browser headers). */
export function billPrintTitle(order, shop) {
  const parts = [shop?.name, order?.order_number].filter(Boolean);
  return parts.join(' — ') || 'Invoice';
}

export function applyShopLogoToTemplate(template, shop) {
  if (!shop?.logoUrl) return template;
  if (template?.logo_url) return template;
  return { ...(template || {}), logo_url: shop.logoUrl };
}
