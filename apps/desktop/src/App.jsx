import { QueryClientProvider } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import { Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';

import { WhatsAppOutboundProvider } from './contexts/WhatsAppOutboundContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import IpAccessOfflineGate from './components/IpAccessOfflineGate.jsx';
import Layout from './components/layout/Layout.jsx';
import PermissionRoute from './components/layout/PermissionRoute.jsx';
import ImagePreviewModal from './components/ui/ImagePreviewModal.jsx';
import Toaster from './components/ui/Toaster.jsx';
import { bootstrapSession } from './lib/api.js';
import { useOnlineStatus } from './hooks/useOnlineStatus.js';
import {
  IP_VALIDATION_RETRY_DELAY_MS,
  shouldBlockForIpValidation,
  shouldScheduleIpValidationRetry,
  shouldWaitForRestrictedBootstrap,
} from './lib/ipAccessState.js';
import { queryClient } from './lib/queryClient.js';
import { useAuthStore } from './stores/authStore.js';
import { useShopStore } from './stores/shopStore.js';
import { useUIStore } from './stores/uiStore.js';
import { MASTER_DEFAULT_TAB } from './pages/master/masterNav.js';
import { lazyRetry } from './lib/lazyRetry.js';

const Login = lazyRetry(() => import('./pages/Login.jsx'));
const ImageCropModal = lazyRetry(() => import('./components/ui/ImageCropModal.jsx'));
const Dashboard = lazyRetry(() => import('./pages/Dashboard.jsx'));
const BookingList = lazyRetry(() => import('./pages/booking/BookingList.jsx'));
const CreateOrder = lazyRetry(() => import('./pages/booking/CreateOrder.jsx'));
const EditBooking = lazyRetry(() => import('./pages/booking/EditBooking.jsx'));
const ProcessOrder = lazyRetry(() => import('./pages/booking/ProcessOrder.jsx'));

function ProcessOrderRoute() {
  const { id } = useParams();
  return <ProcessOrder key={id} />;
}
const QuickAccessoryBill = lazyRetry(() => import('./pages/booking/QuickAccessoryBill.jsx'));
const BookedProductList = lazyRetry(() => import('./pages/booked-products/BookedProductList.jsx'));
const ProductHistory = lazyRetry(() => import('./pages/product-history/ProductHistory.jsx'));
const SecurityTransactionList = lazyRetry(() =>
  import('./pages/security-transactions/SecurityTransactionList.jsx')
);
const SecurityDueList = lazyRetry(() => import('./pages/security-due/SecurityDueList.jsx'));
const SecurityChargesList = lazyRetry(() => import('./pages/security-charges/SecurityChargesList.jsx'));
const DeliveryList = lazyRetry(() => import('./pages/delivery/DeliveryList.jsx'));
const ReturnList = lazyRetry(() => import('./pages/returns/ReturnList.jsx'));
const ProductList = lazyRetry(() => import('./pages/products/ProductList.jsx'));
const ProductFormPage = lazyRetry(() => import('./pages/products/ProductFormPage.jsx'));
const AccessoryFormPage = lazyRetry(() => import('./pages/accessories/AccessoryFormPage.jsx'));
const Master = lazyRetry(() => import('./pages/master/Master.jsx'));
const Inventory = lazyRetry(() => import('./pages/inventory/Inventory.jsx'));
const InventoryBulkUpload = lazyRetry(() => import('./pages/inventory/InventoryBulkUpload.jsx'));
const ProductsCatalogue = lazyRetry(() => import('./pages/inventory/ProductsCatalogue.jsx'));
const Income = lazyRetry(() => import('./pages/income/Income.jsx'));
const JournalVouchers = lazyRetry(() => import('./pages/journal-vouchers/JournalVouchers.jsx'));
const ReceiptVouchers = lazyRetry(() => import('./pages/receipt-vouchers/ReceiptVouchers.jsx'));
const CreditNotes = lazyRetry(() => import('./pages/credit-notes/CreditNotes.jsx'));
const PaymentVoucherList = lazyRetry(() => import('./pages/payment-vouchers/PaymentVoucherList.jsx'));
const Expense = lazyRetry(() => import('./pages/expense/Expense.jsx'));
const LaundryJobList = lazyRetry(() => import('./pages/laundry/LaundryJobList.jsx'));
const CreateLaundryJob = lazyRetry(() => import('./pages/laundry/CreateLaundryJob.jsx'));
const ViewLaundryJobPage = lazyRetry(() => import('./pages/laundry/ViewLaundryJobPage.jsx'));
const SaleList = lazyRetry(() => import('./pages/sales/SaleList.jsx'));
const CreateSale = lazyRetry(() => import('./pages/sales/CreateSale.jsx'));
const PurchaseList = lazyRetry(() => import('./pages/purchases/PurchaseList.jsx'));
const CreatePurchase = lazyRetry(() => import('./pages/purchases/CreatePurchase.jsx'));
const CheckAvailability = lazyRetry(() => import('./pages/availability/CheckAvailability.jsx'));
const ProductsAvailable = lazyRetry(() => import('./pages/availability/ProductsAvailable.jsx'));
const CustomerList = lazyRetry(() => import('./pages/customers/CustomerList.jsx'));
const CustomerFormPage = lazyRetry(() => import('./pages/customers/CustomerFormPage.jsx'));
const Configuration = lazyRetry(() => import('./pages/configuration/Configuration.jsx'));
const Settings = lazyRetry(() => import('./pages/settings/Settings.jsx'));
const ProfilePage = lazyRetry(() => import('./pages/profile/ProfilePage.jsx'));
const ChangePasswordPage = lazyRetry(() => import('./pages/profile/ChangePasswordPage.jsx'));
const AccountLedger = lazyRetry(() => import('./pages/reports/AccountLedger.jsx'));
const DailyCashbook = lazyRetry(() => import('./pages/reports/DailyCashbook.jsx'));
const IncomeExpense = lazyRetry(() => import('./pages/reports/IncomeExpense.jsx'));
const PendingBills = lazyRetry(() => import('./pages/reports/PendingBills.jsx'));
const ProductPerformance = lazyRetry(() => import('./pages/reports/ProductPerformance.jsx'));
const TrialBalance = lazyRetry(() => import('./pages/reports/TrialBalance.jsx'));
const GstReport = lazyRetry(() => import('./pages/reports/GstReport.jsx'));
const SalesmanReport = lazyRetry(() => import('./pages/reports/SalesmanReport.jsx'));
const ItemToCollectList = lazyRetry(() => import('./pages/reports/ItemToCollectList.jsx'));
const ItemToPrepareList = lazyRetry(() => import('./pages/reports/ItemToPrepareList.jsx'));
const CustomOrderList = lazyRetry(() => import('./pages/custom-orders/CustomOrderList.jsx'));
const CustomOrderFormPage = lazyRetry(() => import('./pages/custom-orders/CustomOrderFormPage.jsx'));

/** Deep links use `/customers/:id` — send users to the edit page. */
function CustomerIdToEditRedirect() {
  const { id } = useParams();
  return <Navigate to={`/customers/${id}/edit`} replace />;
}

function AccessoryEditLegacyRedirect() {
  const { id } = useParams();
  return <Navigate to={`/master/accessory/${id}/edit`} replace />;
}

/**
 * Defensive rehydrate.
 *
 * Zustand's `persist` middleware should populate the store from localStorage
 * automatically on module load, but in some Vite-dev / StrictMode / HMR
 * combinations the initial state can race past the hydration. If the store
 * is still empty but the localStorage key exists, we seed the store
 * ourselves *before* React renders — so the first pass of `ProtectedRoute`
 * already sees the token and doesn't bounce to /login on refresh.
 */
function manualRehydrateFromLocalStorage() {
  try {
    if (!useAuthStore.getState().accessToken) {
      const raw = window.localStorage.getItem('wrs.auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        const persisted = parsed?.state || parsed;
        if (persisted?.accessToken) {
          useAuthStore.setState({
            user: persisted.user ?? null,
            accessToken: persisted.accessToken,
            refreshToken: persisted.refreshToken ?? null,
            rememberedIdentity:
              persisted.rememberedIdentity ?? persisted.rememberedEmail ?? '',
            ipAccessRestricted: Boolean(persisted.ipAccessRestricted),
          });
          // eslint-disable-next-line no-console
          console.info('[auth] manual rehydrate seeded auth store from localStorage');
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[auth] manual rehydrate (auth) failed', e);
  }

  try {
    if (!useShopStore.getState().shops?.length) {
      const raw = window.localStorage.getItem('wrs.shop');
      if (raw) {
        const parsed = JSON.parse(raw);
        const persisted = parsed?.state || parsed;
        if (Array.isArray(persisted?.shops) && persisted.shops.length) {
          useShopStore.setState({
            shops: persisted.shops,
            selectedShopId: persisted.selectedShopId || persisted.shops[0]?.id || null,
          });
        }
      }
    }
  } catch {
    /* ignore shop rehydrate errors */
  }
}

manualRehydrateFromLocalStorage();

const ProtectedRoute = () => {
  const token = useAuthStore((s) => s.accessToken);
  const restricted = useAuthStore((s) => s.ipAccessRestricted);
  const validationPending = useAuthStore((s) => s.ipValidationPending);
  const setValidationPending = useAuthStore((s) => s.setIpValidationPending);
  const online = useOnlineStatus();
  const [validating, setValidating] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [automaticRetries, setAutomaticRetries] = useState(0);

  useEffect(() => {
    if (token && restricted && !online) {
      setValidationPending(true);
      setAutomaticRetries(0);
    }
  }, [online, restricted, setValidationPending, token]);

  useEffect(() => {
    if (!token || !restricted || !online || !validationPending) return;
    let alive = true;
    let retryTimer;
    setValidating(true);
    bootstrapSession().finally(() => {
      if (!alive) return;
      setValidating(false);
      const state = useAuthStore.getState();
      if (
        shouldScheduleIpValidationRetry({
          hasToken: Boolean(state.accessToken),
          restricted: state.ipAccessRestricted,
          online,
          validationPending: state.ipValidationPending,
          automaticRetries,
        })
      ) {
        retryTimer = window.setTimeout(() => {
          setAutomaticRetries((count) => count + 1);
          setValidationAttempt((attempt) => attempt + 1);
        }, IP_VALIDATION_RETRY_DELAY_MS);
      }
    });
    return () => {
      alive = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [automaticRetries, online, restricted, token, validationAttempt, validationPending]);

  const retryValidation = () => {
    setAutomaticRetries(0);
    setValidationAttempt((attempt) => attempt + 1);
  };

  if (!token) return <Navigate to="/login" replace />;
  if (
    shouldBlockForIpValidation({
      hasToken: Boolean(token),
      restricted,
      online,
      validationPending,
    })
  ) {
    return (
      <IpAccessOfflineGate
        online={online}
        validating={validating}
        onRetry={retryValidation}
      />
    );
  }
  return <Layout />;
};

const AuthBootstrap = ({ children = null }) => {
  const initialToken = useAuthStore.getState().accessToken;
  const initialUser = useAuthStore.getState().user;
  const initialRestricted = useAuthStore.getState().ipAccessRestricted;
  const [ready, setReady] = useState(
    !shouldWaitForRestrictedBootstrap({
      hasToken: Boolean(initialToken),
      hasUser: Boolean(initialUser),
      restricted: initialRestricted,
    })
  );

  useEffect(() => {
    let alive = true;
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      setReady(true);
      return undefined;
    }
    bootstrapSession().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500 text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          Restoring your session…
        </div>
      </div>
    );
  }
  return children;
};

AuthBootstrap.propTypes = { children: PropTypes.node };

const RouteFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center text-gray-400 text-sm">
    <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin mr-2" />
    Loading…
  </div>
);

const GlobalImageCropModal = () => {
  const session = useUIStore((state) => state.imageCropSession);
  if (!session) return null;
  return (
    <Suspense fallback={null}>
      <ImageCropModal />
    </Suspense>
  );
};

const App = () => {
  useEffect(() => {
    const wheelOpts = { passive: false, capture: true };
    const onWheel = (e) => {
      const t = e.target;
      if (t instanceof window.HTMLInputElement && t.type === 'number') {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', onWheel, wheelOpts);
    return () => document.removeEventListener('wheel', onWheel, wheelOpts);
  }, []);

  return (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <WhatsAppOutboundProvider>
      <HashRouter future={{ v7_relativeSplatPath: true }}>
        <AuthBootstrap>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<PermissionRoute />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/booked-products" element={<BookedProductList />} />
                <Route path="/item-to-collect" element={<ItemToCollectList />} />
                <Route path="/items-to-prepare" element={<ItemToPrepareList />} />
                <Route path="/product-history" element={<ProductHistory />} />
                <Route path="/salesman-report" element={<SalesmanReport />} />
                <Route path="/security-transactions" element={<SecurityTransactionList />} />
                <Route path="/security-due" element={<SecurityDueList />} />
                <Route path="/security-charges" element={<SecurityChargesList />} />
                <Route path="/booking" element={<BookingList />} />
                <Route path="/booking/new" element={<CreateOrder />} />
                <Route path="/booking/quick-accessory" element={<QuickAccessoryBill />} />
                <Route path="/booking/:id/edit" element={<EditBooking />} />
                <Route path="/booking/:id" element={<ProcessOrderRoute />} />
                <Route path="/delivery" element={<DeliveryList />} />
                <Route path="/return" element={<ReturnList />} />
                <Route path="/products" element={<ProductList />} />
                <Route path="/products/new" element={<ProductFormPage />} />
                <Route path="/products/:id/edit" element={<ProductFormPage />} />
                <Route path="/accessories" element={<Navigate to="/master/accessory" replace />} />
                <Route path="/accessories/new" element={<Navigate to="/master/accessory/new" replace />} />
                <Route path="/accessories/:id/edit" element={<AccessoryEditLegacyRedirect />} />
                <Route path="/master/accessory/new" element={<AccessoryFormPage />} />
                <Route path="/master/accessory/:id/edit" element={<AccessoryFormPage />} />
                <Route
                  path="/master"
                  element={<Navigate to={`/master/${MASTER_DEFAULT_TAB}`} replace />}
                />
                <Route path="/master/:tab" element={<Master />} />
                <Route path="/settings/users" element={<Navigate to="/master/users" replace />} />
                <Route path="/settings/reminders" element={<Navigate to="/master/reminders" replace />} />
                <Route
                  path="/settings/accounts_config"
                  element={<Navigate to="/master/accounts" replace />}
                />
                <Route path="/settings/bill_templates" element={<Navigate to="/master/bill_templates" replace />} />
                <Route path="/settings/notifications" element={<Navigate to="/master/reminders" replace />} />
                <Route path="/settings/bulk_upload" element={<Navigate to="/inventory/bulk-upload" replace />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/inventory/products-catalogue" element={<ProductsCatalogue />} />
                <Route path="/inventory/bulk-upload" element={<InventoryBulkUpload />} />
                <Route path="/income" element={<Income />} />
                <Route path="/journal-vouchers" element={<JournalVouchers />} />
                <Route path="/receipt-vouchers" element={<ReceiptVouchers />} />
                <Route path="/credit-notes" element={<CreditNotes />} />
                <Route path="/payment-vouchers" element={<PaymentVoucherList />} />
                <Route path="/expense" element={<Expense />} />
                <Route path="/laundry" element={<LaundryJobList />} />
                <Route path="/laundry/new" element={<CreateLaundryJob />} />
                <Route path="/laundry/:id" element={<ViewLaundryJobPage />} />
                <Route path="/sales" element={<SaleList />} />
                <Route path="/sales/new" element={<CreateSale />} />
                <Route path="/sales/:id/edit" element={<CreateSale mode="edit" />} />
                <Route path="/purchases" element={<PurchaseList />} />
                <Route path="/purchases/new" element={<CreatePurchase />} />
                <Route path="/purchases/:id/edit" element={<CreatePurchase mode="edit" />} />
                <Route path="/availability" element={<CheckAvailability />} />
                <Route path="/products-available" element={<ProductsAvailable />} />
                <Route path="/customers" element={<CustomerList />} />
                <Route path="/customers/new" element={<CustomerFormPage />} />
                <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
                <Route path="/customers/:id" element={<CustomerIdToEditRedirect />} />
                <Route path="/custom-orders" element={<CustomOrderList />} />
                <Route path="/custom-orders/new" element={<CustomOrderFormPage />} />
                <Route path="/custom-orders/:id/edit" element={<CustomOrderFormPage />} />
                <Route path="/reports/daily-cashbook" element={<DailyCashbook />} />
                <Route path="/reports/pending-bills" element={<PendingBills />} />
                <Route path="/reports/product-performance" element={<ProductPerformance />} />
                <Route path="/reports/income-expense" element={<IncomeExpense />} />
                <Route path="/reports/account-ledger" element={<AccountLedger />} />
                <Route path="/reports/trial-balance" element={<TrialBalance />} />
                <Route path="/reports/gst" element={<GstReport />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/profile/change-password" element={<ChangePasswordPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/:tab" element={<Settings />} />
                <Route path="/configuration" element={<Navigate to="/master/categories" replace />} />
                <Route path="/configuration/:tab" element={<Configuration />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </AuthBootstrap>
        <Toaster />
        <ImagePreviewModal />
        <GlobalImageCropModal />
      </HashRouter>
      </WhatsAppOutboundProvider>
    </QueryClientProvider>
  </ErrorBoundary>
  );
};

export default App;
