import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3,
  CalendarCheck,
  CalendarSearch,
  ChevronDown,
  ChevronRight,
  X,
  Cog,
  Droplets,
  LayoutDashboard,
  MoreVertical,
  PackagePlus,
  Shirt,
  SlidersHorizontal,
  Truck,
  Undo2,
  Users,
  Warehouse,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { MODULES } from '@wrs/shared/constants';

import {
  MASTER_DEFAULT_TAB,
  MASTER_NAV_ITEMS,
} from '../../pages/master/masterNav.js';
import { DEFAULT_SETTINGS_TAB, SETTINGS_GROUPS } from '../../pages/settings/settingsNav.js';
import { useIsMobileNav } from '../../hooks/useBreakpoint.js';
import useDashboardListDateDefaults from '../../hooks/useDashboardListDateDefaults.js';
import {
  canViewModule,
  canViewMenu,
  MASTER_TAB_MENU_KEYS,
  MASTER_TAB_MODULES,
  SETTINGS_TAB_MENU_KEYS,
  SETTINGS_TAB_MODULES,
} from '../../lib/routePermissions.js';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';
import { useUIStore } from '../../stores/uiStore.js';

import SidebarIconRail from './SidebarIconRail.jsx';

const TOP_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, module: MODULES.DASHBOARD },
  { to: '/availability', label: 'Check Availability', icon: CalendarSearch, module: MODULES.AVAILABILITY },
  { to: '/products-available', label: 'Products Available', icon: PackagePlus, module: MODULES.AVAILABILITY },
];

const INVENTORY_CHILDREN = [
  { id: 'inventory', label: 'Inventory', to: '/inventory', module: MODULES.INVENTORY },
  { id: 'products-catalogue', label: 'Products Catalogue', to: '/inventory/products-catalogue', module: MODULES.INVENTORY },
  { id: 'products', label: 'Products', to: '/products', module: MODULES.PRODUCTS },
  { id: 'excel-import-product', label: 'Import Product/Accessories', to: '/inventory/bulk-upload', module: MODULES.BULK_IMPORT },
];

/** Exact route or child path only — avoids `/sales` matching `/salesman-report`. */
const isSidebarNavItemActive = (pathname, to) => {
  const p = pathname.replace(/\/$/, '') || '/';
  const pathOnly = String(to || '').split('?')[0].replace(/\/$/, '') || '/';
  if (pathOnly === '/inventory') return p === '/inventory';
  return p === pathOnly || p.startsWith(`${pathOnly}/`);
};
const GENERAL_REPORT_CHILDREN = [
  { id: 'item-to-collect', label: 'Item to Collect', to: '/item-to-collect', module: MODULES.DELIVERY },
  { id: 'items-to-prepare', label: 'Prepare Item', to: '/items-to-prepare', module: MODULES.BOOKING },
  { id: 'delivery', label: 'Delivery', to: '/delivery', module: MODULES.DELIVERY },
  { id: 'return', label: 'Return', to: '/return', module: MODULES.RETURN },
  { id: 'booked-product', label: 'Booked Product', to: '/booked-products', module: MODULES.BOOKING },
  { id: 'security-transaction', label: 'Security Transaction', to: '/security-transactions', module: MODULES.SECURITY },
  { id: 'security-due', label: 'Due Security', to: '/security-due', module: MODULES.SECURITY },
  { id: 'security-charges', label: 'Missing/Damage Charges', to: '/security-charges', module: MODULES.SECURITY },
  { id: 'product-history', label: 'Product History', to: '/product-history', module: MODULES.REPORTS },
  { id: 'salesman-report', label: 'Salesman', to: '/salesman-report', module: MODULES.REPORTS },
  { id: 'customers', label: 'Customers', to: '/customers', module: MODULES.CUSTOMERS },
];
const TRANSACTION_CHILDREN = [
  { id: 'bookings', label: 'Bookings', to: '/booking', module: MODULES.BOOKING },
  { id: 'sales', label: 'Sale', to: '/sales', module: MODULES.SALES },
  { id: 'custom-orders', label: 'Custom Orders', to: '/custom-orders', module: MODULES.CUSTOM_ORDERS },
  { id: 'purchases', label: 'Purchase', to: '/purchases', module: MODULES.PURCHASES },
  { id: 'income', label: 'Income', to: '/income', module: MODULES.INCOME },
  { id: 'expense', label: 'Expense', to: '/expense', module: MODULES.EXPENSES },
  { id: 'washing', label: 'Washing', to: '/laundry', module: MODULES.LAUNDRY },
  { id: 'journal-vouchers', label: 'Journal Vouchers', to: '/journal-vouchers', module: MODULES.VOUCHERS },
  { id: 'payment-voucher', label: 'Payment Voucher', to: '/payment-vouchers', module: MODULES.VOUCHERS },
  { id: 'receipt-voucher', label: 'Receipt Voucher', to: '/receipt-vouchers', module: MODULES.VOUCHERS },
  { id: 'credit-notes', label: 'Credit Notes', to: '/credit-notes', module: MODULES.CREDIT_NOTES },
 
];
const FINANCE_REPORT_CHILDREN = [
  { id: 'daily-cashbook', label: 'Daily cashbook', to: '/reports/daily-cashbook', module: MODULES.REPORTS },
  { id: 'product-performance', label: 'Product Performance', to: '/reports/product-performance', module: MODULES.REPORTS },
  { id: 'pending-bills', label: 'Pending Bills Amounts', to: '/reports/pending-bills', module: MODULES.REPORTS },
  { id: 'income-expense', label: 'Income/Expense', to: '/reports/income-expense', module: MODULES.REPORTS },
  { id: 'account-ledger', label: 'Account Ledger', to: '/reports/account-ledger', module: MODULES.REPORTS },
  { id: 'trial-balance', label: 'Trial Balance', to: '/reports/trial-balance', module: MODULES.REPORTS },
  { id: 'gst-report', label: 'GST Report', to: '/reports/gst', module: MODULES.REPORTS },
];

const SIDEBAR_MENU_KEYS = {
  '/': 'menu.dashboard',
  '/availability': 'menu.check_availability',
  '/products-available': 'menu.products_available',
  '/inventory': 'menu.inventory',
  '/inventory/products-catalogue': 'menu.products_catalogue',
  '/products': 'menu.products',
  '/inventory/bulk-upload': 'menu.bulk_import',
  '/item-to-collect': 'menu.item_to_collect',
  '/items-to-prepare': 'menu.prepare_item',
  '/delivery': 'menu.delivery',
  '/return': 'menu.return',
  '/booked-products': 'menu.booked_product',
  '/security-transactions': 'menu.security_transaction',
  '/security-due': 'menu.due_security',
  '/security-charges': 'menu.missing_damage_charges',
  '/product-history': 'menu.product_history',
  '/salesman-report': 'menu.salesman_report',
  '/customers': 'menu.customers',
  '/booking': 'menu.bookings',
  '/sales': 'menu.sales',
  '/custom-orders': 'menu.custom_orders',
  '/purchases': 'menu.purchases',
  '/income': 'menu.income',
  '/expense': 'menu.expense',
  '/laundry': 'menu.washing',
  '/journal-vouchers': 'menu.journal_vouchers',
  '/payment-vouchers': 'menu.payment_voucher',
  '/receipt-vouchers': 'menu.receipt_voucher',
  '/credit-notes': 'menu.credit_notes',
  '/reports/daily-cashbook': 'menu.daily_cashbook',
  '/reports/product-performance': 'menu.product_performance',
  '/reports/pending-bills': 'menu.pending_bills',
  '/reports/income-expense': 'menu.income_expense',
  '/reports/account-ledger': 'menu.account_ledger',
  '/reports/trial-balance': 'menu.trial_balance',
  '/reports/gst': 'menu.gst_report',
};

function filterByModule(user, items) {
  return items.filter((item) => {
    if (!item.module) return true;
    const menuKey = SIDEBAR_MENU_KEYS[item.to];
    return menuKey
      ? canViewMenu(user, menuKey, item.module)
      : canViewModule(user, item.module);
  });
}


const Sidebar = () => {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const isMobileNav = useIsMobileNav();
  const topNav = filterByModule(user, TOP_NAV);
  const inventoryChildren = filterByModule(user, INVENTORY_CHILDREN);
  const transactionChildren = filterByModule(user, TRANSACTION_CHILDREN);
  const generalReportChildren = filterByModule(user, GENERAL_REPORT_CHILDREN);
  const financeReportChildren = filterByModule(user, FINANCE_REPORT_CHILDREN);
  const masterNavItems = MASTER_NAV_ITEMS.filter((it) => {
    const mod = MASTER_TAB_MODULES[it.id];
    const menuKey = MASTER_TAB_MENU_KEYS[it.id];
    return !mod || (menuKey ? canViewMenu(user, menuKey, mod) : canViewModule(user, mod));
  });
  const settingsGroups = SETTINGS_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => {
      if (it.superAdminOnly && user?.role !== 'super_admin') return false;
      if (it.adminOnly && !['super_admin', 'shop_admin'].includes(user?.role)) return false;
      const mod = SETTINGS_TAB_MODULES[it.id];
      const menuKey = SETTINGS_TAB_MENU_KEYS[it.id];
      return !mod || (menuKey ? canViewMenu(user, menuKey, mod) : canViewModule(user, mod));
    }),
  })).filter((g) => g.items.length > 0);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const closeMobileNav = useUIStore((s) => s.closeMobileNav);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const selectedShopId = useShopStore((s) => s.selectedShopId);

  // Shares the query key with AccessoryList, so having both mounted costs one
  // request rather than two.
  const showAccessoryNav = masterNavItems.some((it) => it.id === 'accessory');
  const { data: accessoryCounts } = useQuery({
    queryKey: ['accessories', 'category-counts'],
    queryFn: () => accessoriesApi.categoryCounts().then((r) => r.data),
    enabled: Boolean(selectedShopId) && showAccessoryNav,
    staleTime: 60_000,
  });
  const lowStockAccessoryCount = Number(accessoryCounts?.low_stock_count || 0);
  const deliveryListDefaults = useDashboardListDateDefaults('pending_delivery');
  const generalReportNavItems = useMemo(
    () =>
      generalReportChildren.map((it) =>
        it.id === 'delivery'
          ? { ...it, to: `/delivery${deliveryListDefaults.searchParamsPath}` }
          : it
      ),
    [generalReportChildren, deliveryListDefaults.searchParamsPath]
  );

  const onNavClick = () => {
    if (isMobileNav) closeMobileNav();
  };

  const onSettingsRoute = location.pathname.startsWith('/settings');
  const onMasterRoute = location.pathname.startsWith('/master');
  const onInventoryRoute = INVENTORY_CHILDREN.some((it) =>
    isSidebarNavItemActive(location.pathname, it.to)
  );
  const onGeneralReportRoute = GENERAL_REPORT_CHILDREN.some((it) =>
    isSidebarNavItemActive(location.pathname, it.to)
  );
  const onTransactionRoute = TRANSACTION_CHILDREN.some((it) =>
    isSidebarNavItemActive(location.pathname, it.to)
  );
  const onFinanceReportRoute = FINANCE_REPORT_CHILDREN.some((it) =>
    isSidebarNavItemActive(location.pathname, it.to)
  );
  const [openSection, setOpenSection] = useState(() => {
    if (onSettingsRoute) return 'settings';
    if (onMasterRoute) return 'master';
    if (onInventoryRoute) return 'inventory';
    if (onTransactionRoute) return 'transaction';
    if (onGeneralReportRoute) return 'general-report';
    if (onFinanceReportRoute) return 'finance-report';
    return null;
  });

  useEffect(() => {
    if (onSettingsRoute) setOpenSection('settings');
    else if (onMasterRoute) setOpenSection('master');
    else if (onInventoryRoute) setOpenSection('inventory');
    else if (onTransactionRoute) setOpenSection('transaction');
    else if (onGeneralReportRoute) setOpenSection('general-report');
    else if (onFinanceReportRoute) setOpenSection('finance-report');
  }, [
    onSettingsRoute,
    onMasterRoute,
    onInventoryRoute,
    onTransactionRoute,
    onGeneralReportRoute,
    onFinanceReportRoute,
  ]);

  const currentSettingsTab = onSettingsRoute
    ? location.pathname.split('/')[2] || DEFAULT_SETTINGS_TAB
    : null;
  const currentMasterTab = onMasterRoute
    ? location.pathname.match(/^\/master\/([^/]+)/)?.[1] ?? null
    : null;

  // Mobile keeps its full off-canvas drawer regardless of the saved desktop mode.
  if (!isMobileNav && sidebarCollapsed) {
    const sections = [
      { id: 'master', label: 'Master', icon: SlidersHorizontal, active: onMasterRoute, visible: masterNavItems.length > 0 },
      { id: 'inventory', label: 'Inventory', icon: Warehouse, active: onInventoryRoute, visible: inventoryChildren.length > 0 },
      { id: 'transaction', label: 'Transaction', icon: BarChart3, active: onTransactionRoute, visible: transactionChildren.length > 0 },
      { id: 'general-report', label: 'General Report', icon: BarChart3, active: onGeneralReportRoute, visible: generalReportChildren.length > 0 },
      { id: 'finance-report', label: 'Finance Report', icon: BarChart3, active: onFinanceReportRoute, visible: financeReportChildren.length > 0 },
      { id: 'settings', label: 'Settings', icon: Cog, active: onSettingsRoute, visible: settingsGroups.length > 0 },
    ].filter((section) => section.visible);

    return (
      <SidebarIconRail
        links={topNav}
        sections={sections}
        onExpand={toggleSidebar}
        onSectionSelect={(section) => {
          setOpenSection(section);
          toggleSidebar();
        }}
      />
    );
  }

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-gray-200 bg-surface font-bold',
        isMobileNav
          ? clsx(
              'fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] max-w-[85vw] transition-transform duration-200 ease-out shadow-pop lg:hidden',
              mobileNavOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
            )
          : 'relative w-60 shrink-0'
      )}
    >
      <div className="relative px-5 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md bg-brand text-white flex items-center justify-center font-bold shrink-0">
            W
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-900 leading-tight truncate">Wedding Rent</div>
            <div className="text-[11px] font-bold text-gray-500 leading-tight">ERP System</div>
          </div>
          </div>
          {isMobileNav ? (
            <button
              type="button"
              onClick={closeMobileNav}
              className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleSidebar}
              className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              title="Collapse side menu (Ctrl+B)"
              aria-label="Collapse side menu"
              aria-expanded={true}
            >
              <MoreVertical size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
        <div>
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Dashboard
          </div>
          <div className="space-y-0.5">
            {topNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavClick}
                  className={({ isActive }) =>
                    clsx('sidebar-item', isActive && 'sidebar-item-active')
                  }
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>

        <div>
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Menu
          </div>
          <div className="space-y-0.5">

        {masterNavItems.length > 0 ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              setOpenSection((v) => (v === 'master' ? null : 'master'));
              if (!onMasterRoute) navigate(`/master/${MASTER_DEFAULT_TAB}`);
            }}
            className={clsx(
              'sidebar-item w-full justify-between',
              onMasterRoute && 'sidebar-item-active'
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <SlidersHorizontal size={16} className="shrink-0" />
              <span className="truncate">Master</span>
            </span>
            {openSection === 'master' ? (
              <ChevronDown size={14} className="text-gray-500" />
            ) : (
              <ChevronRight size={14} className="text-gray-500" />
            )}
          </button>

          {openSection === 'master' ? (
            <div className="mt-1 ml-2 pl-2 border-l border-gray-200 space-y-0.5 pb-1">
              {masterNavItems.map((it) => {
                const to = `/master/${it.id}`;
                const isActive =
                  it.id === 'accessory'
                    ? location.pathname.startsWith('/master/accessory')
                    : currentMasterTab === it.id;
                // Low-stock accessories surface here so the count is visible
                // without opening the dashboard. Hidden entirely at zero.
                const badge = it.id === 'accessory' ? lowStockAccessoryCount : 0;
                return (
                  <NavLink
                    key={it.id}
                    to={to}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition',
                      isActive
                        ? 'bg-brand-light text-brand font-bold'
                        : 'text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <span className="truncate">{it.label}</span>
                    {badge > 0 ? (
                      <span
                        className="ml-auto shrink-0 min-w-[1.15rem] px-1 h-[1.15rem] rounded-full bg-red-500 text-white text-[10px] leading-[1.15rem] text-center font-semibold"
                        title={`${badge} accessor${badge === 1 ? 'y is' : 'ies are'} low on stock`}
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </div>
          ) : null}
        </div>
        ) : null}

        {inventoryChildren.length > 0 ? (
        <div className="pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpenSection((v) => (v === 'inventory' ? null : 'inventory'));
                  if (!onInventoryRoute) navigate(inventoryChildren[0]?.to || '/inventory');
                }}
                className={clsx(
                  'sidebar-item w-full justify-between',
                  onInventoryRoute && 'sidebar-item-active'
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Warehouse size={16} className="shrink-0" />
                  <span className="truncate">Inventory</span>
                </span>
                {openSection === 'inventory' ? (
                  <ChevronDown size={14} className="text-gray-500" />
                ) : (
                  <ChevronRight size={14} className="text-gray-500" />
                )}
              </button>

              {openSection === 'inventory' ? (
                <div className="mt-1 ml-2 pl-2 border-l border-gray-200 space-y-0.5 pb-1">
                  {inventoryChildren.map((it) => {
                    const isActive = isSidebarNavItemActive(location.pathname, it.to);
                    return (
                      <NavLink
                        key={it.id}
                        to={it.to}
                        className={clsx(
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition',
                          isActive
                            ? 'bg-brand-light text-brand font-bold'
                            : 'text-gray-700 hover:bg-gray-50'
                        )}
                      >
                        <span className="truncate">{it.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              ) : null}
            </div>
        ) : null}

            {transactionChildren.length > 0 ? (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpenSection((v) => (v === 'transaction' ? null : 'transaction'));
                  if (!onTransactionRoute) navigate(transactionChildren[0].to);
                }}
                className={clsx(
                  'sidebar-item w-full justify-between',
                  onTransactionRoute && 'sidebar-item-active'
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <BarChart3 size={16} className="shrink-0" />
                  <span className="truncate">Transaction</span>
                </span>
                {openSection === 'transaction' ? (
                  <ChevronDown size={14} className="text-gray-500" />
                ) : (
                  <ChevronRight size={14} className="text-gray-500" />
                )}
              </button>

              {openSection === 'transaction' ? (
                <div className="mt-1 ml-2 pl-2 border-l border-gray-200 space-y-0.5 pb-1">
                  {transactionChildren.map((it) => {
                    const isActive = isSidebarNavItemActive(location.pathname, it.to);
                    return (
                      <NavLink
                        key={it.id}
                        to={it.to}
                        className={clsx(
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition',
                          isActive
                            ? 'bg-brand-light text-brand font-bold'
                            : 'text-gray-700 hover:bg-gray-50'
                        )}
                      >
                        <span className="truncate">{it.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              ) : null}
            </div>
            ) : null}

            {generalReportChildren.length > 0 ? (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpenSection((v) => (v === 'general-report' ? null : 'general-report'));
                  if (!onGeneralReportRoute) navigate(generalReportChildren[0].to);
                }}
                className={clsx(
                  'sidebar-item w-full justify-between',
                  onGeneralReportRoute && 'sidebar-item-active'
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <BarChart3 size={16} className="shrink-0" />
                  <span className="truncate">General Report</span>
                </span>
                {openSection === 'general-report' ? (
                  <ChevronDown size={14} className="text-gray-500" />
                ) : (
                  <ChevronRight size={14} className="text-gray-500" />
                )}
              </button>

              {openSection === 'general-report' ? (
                <div className="mt-1 ml-2 pl-2 border-l border-gray-200 space-y-0.5 pb-1">
                  {generalReportNavItems.map((it) => {
                    const isActive = isSidebarNavItemActive(location.pathname, it.to);
                    return (
                      <NavLink
                        key={it.id}
                        to={it.to}
                        className={clsx(
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition',
                          isActive
                            ? 'bg-brand-light text-brand font-bold'
                            : 'text-gray-700 hover:bg-gray-50'
                        )}
                      >
                        <span className="truncate">{it.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              ) : null}
            </div>
            ) : null}

            {financeReportChildren.length > 0 ? (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpenSection((v) => (v === 'finance-report' ? null : 'finance-report'));
                  if (!onFinanceReportRoute) navigate(financeReportChildren[0].to);
                }}
                className={clsx(
                  'sidebar-item w-full justify-between',
                  onFinanceReportRoute && 'sidebar-item-active'
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <BarChart3 size={16} className="shrink-0" />
                  <span className="truncate">Finance Report</span>
                </span>
                {openSection === 'finance-report' ? (
                  <ChevronDown size={14} className="text-gray-500" />
                ) : (
                  <ChevronRight size={14} className="text-gray-500" />
                )}
              </button>

              {openSection === 'finance-report' ? (
                <div className="mt-1 ml-2 pl-2 border-l border-gray-200 space-y-0.5 pb-1">
                  {financeReportChildren.map((it) => {
                    const isActive = isSidebarNavItemActive(location.pathname, it.to);
                    return (
                      <NavLink
                        key={it.id}
                        to={it.to}
                        className={clsx(
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition',
                          isActive
                            ? 'bg-brand-light text-brand font-bold'
                            : 'text-gray-700 hover:bg-gray-50'
                        )}
                      >
                        <span className="truncate">{it.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              ) : null}
            </div>
            ) : null}
          </div>
        </div>

        {settingsGroups.length > 0 ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              setOpenSection((v) => (v === 'settings' ? null : 'settings'));
              if (!onSettingsRoute) {
                const first = settingsGroups[0]?.items[0]?.id || DEFAULT_SETTINGS_TAB;
                navigate(`/settings/${first}`);
              }
            }}
            className={clsx(
              'sidebar-item w-full justify-between',
              onSettingsRoute && 'sidebar-item-active'
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Cog size={16} className="shrink-0" />
              <span className="truncate">Settings</span>
            </span>
            {openSection === 'settings' ? (
              <ChevronDown size={14} className="text-gray-500" />
            ) : (
              <ChevronRight size={14} className="text-gray-500" />
            )}
          </button>

          {openSection === 'settings' ? (
            <div className="mt-1 ml-2 pl-2 border-l border-gray-200 space-y-2 pb-1">
              {settingsGroups.map((group) => (
                <div key={group.id}>
                  <div className="px-1 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((it) => {
                      const Icon = it.icon;
                      const isActive = currentSettingsTab === it.id;
                      return (
                        <NavLink
                          key={it.id}
                          to={`/settings/${it.id}`}
                          className={clsx(
                            'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition',
                            isActive
                              ? 'bg-brand-light text-brand font-bold'
                              : 'text-gray-700 hover:bg-gray-50'
                          )}
                        >
                          <Icon
                            size={13}
                            className={clsx('shrink-0', isActive ? 'text-brand' : 'text-gray-500')}
                          />
                          <span className="truncate">{it.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        ) : null}
      </nav>

      <div className="border-t border-gray-200 px-3 py-2.5 text-[11px] font-bold text-gray-500">
        v{import.meta.env.VITE_APP_VERSION || '0.1.0'}
      </div>
    </aside>
  );
};

Sidebar.propTypes = {};

export default Sidebar;
