import { APP_LOGO_LETTER, APP_NAME, APP_TAGLINE } from '@wrs/shared/constants';
import { CalendarCheck, Lock, Package, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Button from '../components/ui/Button.jsx';
import Checkbox from '../components/ui/Checkbox.jsx';
import Input from '../components/ui/Input.jsx';
import PasswordInput from '../components/ui/PasswordInput.jsx';
import { api, unwrap } from '../lib/api.js';
import { authApi } from '../lib/api/auth.js';
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
  const [view, setView] = useState('login');
  const [forgotIdentity, setForgotIdentity] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const resetForgot = () => {
    setView('login');
    setErr(null);
    setOtp('');
    setChallengeId('');
    setMaskedEmail('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const apiError = (error, fallback) =>
    error?.response?.data?.error?.message || error?.message || fallback;

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

  const onRequestOtp = async (e) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const resp = await authApi.requestForgotPassword({ identity: forgotIdentity });
      setChallengeId(resp.data.challenge_id);
      setMaskedEmail(resp.data.email || '');
      setOtp('');
      setView('otp');
      toast.success(`OTP sent to ${resp.data.email || 'your email'}`);
    } catch (error) {
      setErr(apiError(error, 'Could not send OTP'));
    } finally {
      setLoading(false);
    }
  };

  const onVerifyOtp = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!/^\d{6}$/.test(otp)) {
      setErr('Enter the 6-digit OTP');
      return;
    }
    setLoading(true);
    try {
      await authApi.verifyForgotPasswordOtp({ challenge_id: challengeId, otp });
      setView('password');
    } catch (error) {
      setErr(apiError(error, 'Incorrect OTP'));
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async (e) => {
    e.preventDefault();
    setErr(null);
    if (newPassword !== confirmPassword) {
      setErr('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetForgotPassword({
        challenge_id: challengeId,
        otp,
        new_password: newPassword,
        confirm: confirmPassword,
      });
      toast.success('Password updated. Sign in with your new password.');
      setIdentity(forgotIdentity);
      setPassword('');
      resetForgot();
    } catch (error) {
      setErr(apiError(error, 'Could not reset password'));
    } finally {
      setLoading(false);
    }
  };

  const title =
    view === 'login'
      ? 'Welcome back'
      : view === 'password'
        ? 'Set new password'
        : view === 'otp'
          ? 'Verify OTP'
          : 'Forgot password';
  const subtitle =
    view === 'login'
      ? `Sign in to ${APP_NAME}`
      : view === 'otp'
        ? `Enter the 6-digit code sent to ${maskedEmail || 'your email'}`
        : view === 'password'
          ? 'Choose a new password for this administrator account'
          : 'Shop admin and super admin can reset by email OTP';

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
            <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>

            {view === 'login' ? (
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

              <div className="flex items-center justify-between gap-3">
                <Checkbox checked={remember} onChange={setRemember} label="Remember me" />
                <button
                  type="button"
                  className="text-sm font-medium text-brand hover:underline"
                  onClick={() => {
                    setForgotIdentity(identity);
                    setErr(null);
                    setView('identity');
                  }}
                >
                  Forgot password?
                </button>
              </div>

              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Sign in
              </Button>
            </form>
            ) : null}

            {view === 'identity' ? (
            <form onSubmit={onRequestOtp} className="mt-8 space-y-5">
              {err ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {err}
                </div>
              ) : null}
              <Input
                label="Phone number or email"
                type="text"
                autoComplete="username"
                required
                value={forgotIdentity}
                onChange={(e) => setForgotIdentity(e.target.value)}
                placeholder="Admin phone or email"
              />
              <p className="text-xs text-gray-500">
                Other staff cannot reset from here. Contact your shop admin.
              </p>
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Send OTP
              </Button>
              <button
                type="button"
                className="block w-full text-center text-sm font-medium text-gray-600 hover:text-brand"
                onClick={resetForgot}
              >
                Back to sign in
              </button>
            </form>
            ) : null}

            {view === 'otp' ? (
            <form onSubmit={onVerifyOtp} className="mt-8 space-y-5">
              {err ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {err}
                </div>
              ) : null}
              <Input
                label="Email OTP"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
              />
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Verify OTP
              </Button>
              <button
                type="button"
                className="block w-full text-center text-sm font-medium text-gray-600 hover:text-brand"
                onClick={() => {
                  setErr(null);
                  setView('identity');
                }}
              >
                Use a different account
              </button>
            </form>
            ) : null}

            {view === 'password' ? (
            <form onSubmit={onResetPassword} className="mt-8 space-y-5">
              {err ? (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {err}
                </div>
              ) : null}
              <PasswordInput
                id="forgot-new-password"
                label="New password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                hint="Minimum 8 characters with uppercase, lowercase and number"
              />
              <PasswordInput
                id="forgot-confirm-password"
                label="Confirm password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Update password
              </Button>
              <button
                type="button"
                className="block w-full text-center text-sm font-medium text-gray-600 hover:text-brand"
                onClick={resetForgot}
              >
                Back to sign in
              </button>
            </form>
            ) : null}

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
