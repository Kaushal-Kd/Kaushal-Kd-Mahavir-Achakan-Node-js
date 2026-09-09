import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Store } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../../lib/api.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { toast } from '../../stores/uiStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';

const ShopSelector = () => {
  const online = useOnlineStatus();
  const shops = useShopStore((s) => s.shops);
  const selectedId = useShopStore((s) => s.selectedShopId);
  const selectShop = useShopStore((s) => s.selectShop);
  const setUser = useAuthStore((s) => s.setUser);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selected = shops.find((s) => s.id === selectedId);

  if (shops.length === 0) return null;
  if (shops.length === 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-1.5 text-sm">
        <Store size={15} className="text-brand" />
        <span className="font-medium text-gray-900">{selected?.shop_name}</span>
      </div>
    );
  }

  const onPick = async (id) => {
    if (id === selectedId) return setOpen(false);
    if (!online) {
      toast.error('Connect to the server to validate access before switching shops');
      return;
    }
    setOpen(false);
    setReloading(true);
    try {
      const response = await api.post(
        '/auth/select-shop',
        { shop_id: id },
        { headers: { 'x-shop-id': id } }
      );
      useAuthStore.getState().setIpAccessState(response.data.data.ip_access_restricted, false);
      await queryClient.cancelQueries();
      selectShop(id);
      const selectedShop = shops.find((shop) => shop.id === id);
      const currentUser = useAuthStore.getState().user;
      if (currentUser && selectedShop?.shop_permissions) {
        setUser({ ...currentUser, permissions: selectedShop.shop_permissions });
      }
      await queryClient.resetQueries();
    } catch (error) {
      toast.error(error?.response?.data?.error?.message || 'Could not validate shop access');
    } finally {
      setReloading(false);
    }
  };

  if (reloading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-surface/90">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-surface px-5 py-4 text-sm text-gray-700 shadow-pop">
          <span
            className="h-5 w-5 shrink-0 rounded-full border-2 border-brand border-t-transparent animate-spin"
            aria-hidden
          />
          <span>Switching shop…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-gray-200 bg-surface px-3 py-1.5 text-sm hover:border-brand"
      >
        <Store size={15} className="text-brand" />
        <span className="font-medium text-gray-900 max-w-[180px] truncate">
          {selected?.shop_name || 'Select shop'}
        </span>
        <ChevronDown size={14} className="text-gray-500" />
      </button>

      {open ? (
        <div className="absolute right-0 mt-1 w-72 max-h-80 overflow-auto rounded-md border border-gray-200 bg-surface shadow-pop z-30">
          {shops.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-gray-50 text-left"
            >
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{s.shop_name}</div>
                {s.city ? <div className="text-xs text-gray-500 truncate">{s.city}</div> : null}
              </div>
              {s.id === selectedId ? <Check size={16} className="text-brand shrink-0" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

ShopSelector.propTypes = {};

export default ShopSelector;
