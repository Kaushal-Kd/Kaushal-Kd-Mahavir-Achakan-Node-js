import { useQueries, useQuery } from '@tanstack/react-query';
import { Bell, Camera, Menu, PanelLeftOpen, Search, ShoppingCart, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { accessoriesApi } from '../../lib/api/accessories.js';
import { draftsApi } from '../../lib/api/drafts.js';
import { queryKeys } from '../../lib/queryKeys.js';
import { ordersApi } from '../../lib/api/orders.js';
import { productsApi } from '../../lib/api/products.js';
import { salesApi } from '../../lib/api/sales.js';

import Badge from '../ui/Badge.jsx';
import { useIsMobileNav } from '../../hooks/useBreakpoint.js';
import { lazyRetry } from '../../lib/lazyRetry.js';
import { useUIStore } from '../../stores/uiStore.js';
import ShopSelector from './ShopSelector.jsx';
import SyncIndicator from './SyncIndicator.jsx';
import UserMenu from './UserMenu.jsx';

const CART_DRAFT_KIND = 'availability_cart';
const BarcodeScannerModal = lazyRetry(() => import('../ui/BarcodeScannerModal.jsx'));

const SEARCH_HIT_LIMIT = 8;

const KIND_META = {
  booking: { typeLabel: 'Booking', path: (row) => `/booking/${row.id}` },
  product: { typeLabel: 'Product', path: (row) => `/products/${row.id}/edit` },
  sale: { typeLabel: 'Sale', path: (row) => `/sales/${row.id}/edit` },
  accessory: { typeLabel: 'Accessory', path: (row) => `/master/accessory/${row.id}/edit` },
};

function bookingSearchTitle(row) {
  const no = row.order_number ? String(row.order_number) : '';
  const name = row.customer_name || row.pickup_name || row.reference_name || '';
  const phone =
    row.customer_phone || row.contact_phone1 || row.pickup_number || row.phone1 || row.phone2 || '';
  const parts = [no, name, phone].filter(Boolean);
  return parts.length ? parts.join(' · ') : `Booking #${row.id}`;
}

function productSearchTitle(row) {
  const name = row.name || 'Product';
  const code = row.code || row.barcode || '';
  return code ? `${name} · ${code}` : name;
}

function saleSearchTitle(row) {
  const bill = row.sale_number ? String(row.sale_number) : '';
  const name = row.customer_name || '';
  const parts = [bill, name].filter(Boolean);
  return parts.length ? parts.join(' · ') : `Sale #${row.id}`;
}

function accessorySearchTitle(row) {
  const name = row.name || 'Accessory';
  const code = row.code || row.barcode || '';
  return code ? `${name} · ${code}` : name;
}

const TopBar = () => {
  const navigate = useNavigate();
  const isMobileNav = useIsMobileNav();
  const isSearchOpen = useUIStore((s) => s.isSearchOpen);
  const openSearch = useUIStore((s) => s.openSearch);
  const closeSearch = useUIStore((s) => s.closeSearch);
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const searchWrapRef = useRef(null);
  const mobileSearchRef = useRef(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const { data: cartDraftRows } = useQuery({
    queryKey: queryKeys.drafts.availabilityCart,
    queryFn: () => draftsApi.list({ kind: CART_DRAFT_KIND }).then((r) => r.data || []),
    staleTime: 5 * 60_000,
  });
  const cartCustomerCount = useMemo(() => {
    const ids = new Set();
    for (const row of cartDraftRows || []) {
      const customerId = row?.data?.customer_id;
      if (customerId) ids.add(String(customerId));
    }
    return ids.size;
  }, [cartDraftRows]);
  const term = debouncedSearch.trim();
  const searchEnabled = term.length > 1;
  const searchQueries = useQueries({
    queries: [
      {
        queryKey: ['topbar-search', 'bookings', term],
        queryFn: () =>
          ordersApi.list({ search: term, per_page: SEARCH_HIT_LIMIT }).then((r) => r.data || []),
        enabled: searchEnabled,
      },
      {
        queryKey: ['topbar-search', 'products', term],
        queryFn: () =>
          productsApi.list({ search: term, per_page: SEARCH_HIT_LIMIT }).then((r) => r.data || []),
        enabled: searchEnabled,
      },
      {
        queryKey: ['topbar-search', 'sales', term],
        queryFn: () =>
          salesApi
            .list({
              search: term,
              per_page: SEARCH_HIT_LIMIT,
              page: 1,
              sort: '-s.sale_date',
            })
            .then((r) => r.data || []),
        enabled: searchEnabled,
      },
      {
        queryKey: ['topbar-search', 'accessories', term],
        queryFn: () =>
          accessoriesApi.list({ search: term, per_page: SEARCH_HIT_LIMIT }).then((r) => r.data || []),
        enabled: searchEnabled,
      },
    ],
  });
  const [bookingQ, productQ, saleQ, accessoryQ] = searchQueries;
  const loading = searchEnabled && searchQueries.some((q) => q.isLoading);
  const bookings = bookingQ?.data || [];
  const products = productQ?.data || [];
  const sales = saleQ?.data || [];
  const accessories = accessoryQ?.data || [];
  const hasAnyResult = bookings.length || products.length || sales.length || accessories.length;

  const searchHits = useMemo(() => {
    const hits = [];
    for (const row of bookings) {
      hits.push({ kind: 'booking', row, title: bookingSearchTitle(row) });
    }
    for (const row of sales) {
      hits.push({ kind: 'sale', row, title: saleSearchTitle(row) });
    }
    for (const row of products) {
      hits.push({ kind: 'product', row, title: productSearchTitle(row) });
    }
    for (const row of accessories) {
      hits.push({ kind: 'accessory', row, title: accessorySearchTitle(row) });
    }
    return hits;
  }, [bookings, products, sales, accessories]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!searchWrapRef.current?.contains(event.target)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!isMobileNav || !isSearchOpen) return undefined;
    const id = window.requestAnimationFrame(() => {
      mobileSearchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isMobileNav, isSearchOpen]);

  const goHit = (kind, row) => {
    const meta = KIND_META[kind];
    if (!meta?.path) return;
    setDropdownOpen(false);
    if (isMobileNav) closeSearch();
    navigate(meta.path(row));
  };

  const openScanner = useCallback(() => {
    setDropdownOpen(false);
    setScannerOpen(true);
  }, []);

  const handleScannedCode = useCallback((scanned) => {
    const code = String(scanned || '').trim();
    if (!code) return;
    setScannerOpen(false);
    setSearch(code);
    setDebouncedSearch(code);
    setDropdownOpen(true);
  }, []);

  const searchDropdown = dropdownOpen ? (
    <div className="absolute top-[calc(100%+0.35rem)] left-0 right-0 rounded-md border border-gray-200 bg-surface shadow-pop z-40 max-h-[min(22rem,70vh)] overflow-auto p-1">
      {searchEnabled ? (
        <>
          {loading ? <ResultHint text="Searching..." /> : null}
          {!loading ? (
            <>
              {searchHits.map((hit) => (
                <SearchHitRow key={`${hit.kind}-${hit.row.id}`} hit={hit} onPick={() => goHit(hit.kind, hit.row)} />
              ))}
              {!hasAnyResult ? <ResultHint text="No matching records found." /> : null}
            </>
          ) : null}
        </>
      ) : (
        <ResultHint text="Type at least 2 characters..." />
      )}
    </div>
  ) : null;

  const searchField = (inputRef, wrapClass) => (
    <div ref={searchWrapRef} className={wrapClass}>
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-surface px-3 py-1.5 text-sm text-gray-500">
        <Search size={15} />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Search bookings, products, sales…"
          className="w-full min-w-0 flex-1 bg-transparent outline-none text-sm text-gray-700 placeholder:text-gray-400"
          aria-label="Search"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openScanner}
          className="shrink-0 rounded-md p-0.5 text-gray-500 hover:text-brand hover:bg-brand-light/60"
          title="Scan barcode / QR"
          aria-label="Scan barcode or QR code"
        >
          <Camera size={15} aria-hidden />
        </button>
      </div>
      {searchDropdown}
    </div>
  );

  return (
    <div className="shrink-0 border-b border-gray-200 bg-surface">
    <header className="h-14 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-5">
      {isMobileNav ? (
        <button
          type="button"
          onClick={toggleMobileNav}
          className="shrink-0 rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-brand lg:hidden"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
      ) : sidebarCollapsed ? (
        <button
          type="button"
          onClick={toggleSidebar}
          className="shrink-0 rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-brand"
          title="Show side menu (Ctrl+B)"
          aria-label="Show side menu"
        >
          <PanelLeftOpen size={20} />
        </button>
      ) : null}
      {searchField(null, 'hidden lg:block relative w-[22rem] max-w-[min(22rem,calc(100vw-12rem))]')}

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {isMobileNav ? (
          <button
            type="button"
            onClick={() => (isSearchOpen ? closeSearch() : openSearch())}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-brand lg:hidden"
            aria-label={isSearchOpen ? 'Close search' : 'Open search'}
          >
            {isSearchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
        ) : null}
        <SyncIndicator />
        <div className="hidden sm:block">
          <ShopSelector />
        </div>
        <button
          type="button"
          className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-brand relative"
          aria-label="Availability cart"
          title="Availability cart"
          onClick={() => navigate('/availability?tab=cart')}
        >
          <ShoppingCart size={17} />
          {cartCustomerCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-brand text-white text-[10px] leading-4 text-center font-semibold">
              {cartCustomerCount > 99 ? '99+' : cartCustomerCount}
            </span>
          ) : null}
        </button>
        <button
          className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-brand relative"
          aria-label="Notifications"
        >
          <Bell size={17} />
        </button>
        <UserMenu />
      </div>
    </header>
    {isMobileNav && isSearchOpen ? (
      <div className="border-t border-gray-100 px-3 py-2 lg:hidden">
        {searchField(mobileSearchRef, 'relative w-full')}
        <div className="mt-2 sm:hidden">
          <ShopSelector />
        </div>
      </div>
    ) : null}

      {scannerOpen ? (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            isOpen
            onClose={() => setScannerOpen(false)}
            onDetected={handleScannedCode}
            title="Scan barcode / QR to search"
          />
        </Suspense>
      ) : null}
    </div>
  );
};

const SearchHitRow = ({ hit, onPick }) => {
  const meta = KIND_META[hit.kind];
  const badgeTone = hit.kind === 'booking' ? 'brand' : 'gray';
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full flex items-start justify-between gap-2 text-left px-2 py-2 rounded-md hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
    >
      <span className="min-w-0 flex-1 text-xs text-gray-800 leading-snug break-words">{hit.title}</span>
      <Badge tone={badgeTone} className="shrink-0 mt-0.5">
        {meta.typeLabel}
      </Badge>
    </button>
  );
};

SearchHitRow.propTypes = {
  hit: PropTypes.shape({
    kind: PropTypes.oneOf(Object.keys(KIND_META)).isRequired,
    row: PropTypes.shape({ id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]) }).isRequired,
    title: PropTypes.string.isRequired,
  }).isRequired,
  onPick: PropTypes.func.isRequired,
};

const ResultHint = ({ text }) => (
  <div className="px-2 py-2 text-xs text-gray-500">
    {text}
  </div>
);

ResultHint.propTypes = { text: PropTypes.string.isRequired };

export default TopBar;
