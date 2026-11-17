import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useShopStore = create(
  persist(
    (set, get) => ({
      shops: [],
      selectedShopId: null,

      /**
       * @param {object[]} shops
       * @param {string|null} [preferredShopId] server-side last selected shop; used when the
       *   local selection is gone (e.g. after logout) so the user lands back on that shop.
       */
      setShops(shops, preferredShopId = null) {
        const list = shops || [];
        const has = (id) => Boolean(id) && list.some((s) => s.id === id);
        const current = get().selectedShopId;
        set({
          shops: list,
          selectedShopId: has(current)
            ? current
            : has(preferredShopId)
              ? preferredShopId
              : list.find((s) => s.shop_is_default)?.id || list[0]?.id || null,
        });
      },

      selectShop(id) {
        set({ selectedShopId: id });
      },

      clear() {
        set({ shops: [], selectedShopId: null });
      },

      get selectedShop() {
        return get().shops.find((s) => s.id === get().selectedShopId) || null;
      },
    }),
    {
      name: 'wrs.shop',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ shops: s.shops, selectedShopId: s.selectedShopId }),
    }
  )
);
