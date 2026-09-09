import { APP_LOGO_LETTER, APP_NAME, APP_TAGLINE } from '@wrs/shared/constants';
import { CalendarCheck, Lock, Package, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Button from '../components/ui/Button.jsx';
import Checkbox from '../components/ui/Checkbox.jsx';
import Input from '../components/ui/Input.jsx';
import PasswordInput from '../components/ui/PasswordInput.jsx';
import { api, unwrap } from '../lib/api.js';
import { queryClient } from '../lib/queryClient.js';
import { getReadableDeviceName, getStableDeviceId } from '../lib/deviceIdentity.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';
import { toast } from '../stores/uiStore.js';

const HIGHLIGHTS = [
  { icon: CalendarCheck, label: 'Bookings and fittings in one calendar' },
  { icon: Package, label: 'Live inventory across every garment' },
  { icon: Store, label: 'Multi-shop staff, one sign-in' },
];

const Login = () => {
  const rememberedIdentity = useAuthStore((s) => s.rememberedIdentity);
  const setRememberedIdentity = useAuthStore((s) => s.setRememberedIdentity);
  const setSession = useAuthStore((s) => s.setSession);
  const accessDeniedMessage = useAuthStore((s) => s.accessDeniedMessage);
  const clearAccessDeniedMessage = useAuthStore((s) => s.clearAccessDeniedMessage);
  const setShops = useShopStore((s) => s.setShops);
  const isAuthed = useAuthStore((s) => !!s.accessToken && !!s.user);
  const navigate = useNavigate();

  const [identity, setIdentity] = useState(rememberedIdentity || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(!!rememberedIdentity);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(accessDeniedMessage);

  useEffect(() => {
    if (accessDeniedMessage) clearAccessDeniedMessage();
  }, [accessDeniedMessage, clearAccessDeniedMessage]);

  if (isAuthed) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const resp = await api
        .post('/auth/login', {
          identity,
          password,
          remember,
          device_id: getStableDeviceId(),
          device_name: getReadableDeviceName(),
        })
        .then(unwrap);
      const { user, shops, access_token, refresh_token, ip_access_restricted } = resp.data;
      setShops(shops);
      const selectedShopId = useShopStore.getState().selectedShopId;
      const selectedShop = shops.find((shop) => shop.id === selectedShopId);
      setSession(
        { ...user, permissions: selectedShop?.shop_permissions || user.permissions },
        access_token,
        refresh_token,
        ip_access_restricted
      );
      setRememberedIdentity(remember ? identity : '');
      // Drop anything cached by a previous session so the dashboard always
      // fetches fresh data for the user who just signed in.
      queryClient.clear();
      toast.success(`Welcome back, ${user.name}`);
      navigate('/');
    } catch (error) {
      setErr(error.response?.data?.error?.message || error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface lg:flex lg:h-screen lg:overflow-hidden">
      <aside className="hidden border-r border-gray-200 bg-surface lg:flex lg:w-[44%] lg:shrink-0 lg:flex-col lg:justify-between lg:px-12 lg:py-12 xl:px-16">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand text-lg font-bold text-white">
            {APP_LOGO_LETTER}
          </div>
          <div>
            <div className="text-base font-semibold leading-tight text-gray-900">{APP_NAME}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              {APP_TAGLINE}
            </div>
          </div>
        </div>

        <div className="max-w-md">
          <div className="mb-5 h-1 w-10 rounded-sm bg-brand" />
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand xl:text-[2.35rem]">
            Run every shop from one place
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-gray-600">
            Bookings, stock, and staff — designed for wedding wear rental and retail.
          </p>
          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-light text-brand">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-gray-800">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-gray-400">Authorized shop staff only</p>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col bg-gray-50">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-surface px-5 py-4 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
            {APP_LOGO_LETTER}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">{APP_NAME}</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              {APP_TAGLINE}
            </div>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[420px] rounded-lg border border-gray-200 bg-surface p-6 shadow-card sm:p-8">
            <div className="mb-3 h-1 w-10 rounded-sm bg-brand" />
            <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
            <p className="mt-1 text-sm text-gray-500">Sign in to {APP_NAME}</p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              {err ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {err}
                </div>
              ) : null}

              <Input
                label="Phone number"
                type="text"
                inputMode="tel"
                autoComplete="username"
                required
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="10-digit phone number"
                hint="Existing accounts may still use email."
              />

              <PasswordInput
                id="login-password"
                label="Password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />

              <Checkbox checked={remember} onChange={setRemember} label="Remember me" />

              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Sign in
              </Button>

              <p className="text-center text-xs text-gray-500">
                Need a password reset? Ask your administrator.
              </p>
            </form>

            <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-gray-400">
              <Lock size={12} aria-hidden="true" />
              Your session is protected on this device.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Login;
