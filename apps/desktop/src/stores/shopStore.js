import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useShopStore = create(
  persist(
    (set, get) => ({
      shops: [],
      selectedShopId: null,

      setShops(shops) {
        const list = shops || [];
        const current = get().selectedShopId;
        const isValid = list.some((s) => s.id === current);
        set({
          shops: list,
          selectedShopId:
            isValid && current
              ? current
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
