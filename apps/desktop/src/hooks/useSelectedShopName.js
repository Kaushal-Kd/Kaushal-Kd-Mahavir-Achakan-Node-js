import { useShopStore } from '../stores/shopStore.js';

/** @returns {string} */
export function useSelectedShopName() {
  return useShopStore(
    (s) => s.shops.find((shop) => shop.id === s.selectedShopId)?.shop_name || ''
  );
}
