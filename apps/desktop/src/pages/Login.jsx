import { APP_LOGO_LETTER, APP_NAME } from '@wrs/shared/constants';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import { api, unwrap } from '../lib/api.js';
import { queryClient } from '../lib/queryClient.js';
import { getReadableDeviceName, getStableDeviceId } from '../lib/deviceIdentity.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';
import { toast } from '../stores/uiStore.js';

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
  const [showPw, setShowPw] = useState(false);
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-lg bg-brand text-white flex items-center justify-center font-bold text-lg mb-3">
            {APP_LOGO_LETTER}
          </div>
          <h1 className="text-xl font-semibold text-gray-900">{APP_NAME}</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your shop account</p>
        </div>

        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <Input
            label="Phone number"
            type="text"
            inputMode="tel"
            autoComplete="username"
            required
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="10-digit phone number"
            hint="Existing accounts may use email during the transition."
          />

          <div>
            <label className="label" htmlFor="login-password">Password</label>
            <div className="relative">
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand"
                aria-label="Toggle password visibility"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-gray-300 text-brand focus:ring-brand"
              />
              Remember me
            </label>
            <button type="button" className="text-sm text-brand hover:underline">
              Forgot password?
            </button>
          </div>

          {err ? (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
              {err}
            </div>
          ) : null}

          <Button type="submit" className="w-full" loading={loading}>
            Sign In
          </Button>

          <div className="text-center text-xs text-gray-500">
            <Lock size={12} className="inline mr-1" />
            Secured with JWT + device binding
          </div>
        </form>

        <p className="text-center text-xs text-gray-500 mt-4">
          <Mail size={12} className="inline mr-1" />
          Contact your administrator if you need access
        </p>
      </div>
    </div>
  );
};

export default Login;
