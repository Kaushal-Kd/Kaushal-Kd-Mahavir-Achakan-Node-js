import axios from 'axios';

import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';

import { queryClient } from './queryClient.js';
import { getReadableDeviceName, getStableDeviceId } from './deviceIdentity.js';
import { assertEmailSettingsScope } from './shopEmailSettingsState.js';

/**
 * Scrub any leaked state on a true logout.
 * The query cache is a module singleton, so it must be cleared too — otherwise
 * the next session in the same window reads the previous user's data (gcTime is 30m).
 */
export function hardLogout(accessDeniedMessage = null) {
  useAuthStore.getState().logout(accessDeniedMessage);
  useShopStore.getState().clear();
  queryClient.clear();
}

function resolveBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    const isWeb = typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol);
    const pointsToLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(envUrl);
    const runningOnLocalhost =
      typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    if (!isWeb || !pointsToLocalhost || runningOnLocalhost) return envUrl;
  }

  // On hosted web (Vercel), use same-origin backend route.
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    return `${window.location.origin}/api`;
  }

  // Electron/file:// and local dev fallback.
  return 'http://localhost:4000/api';
}

const baseURL = resolveBaseUrl();

export const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (config.wrsEmailScope) {
    const user = useAuthStore.getState().user;
    assertEmailSettingsScope(config.wrsEmailScope, {
      userId: user?.id,
      role: user?.role,
      shopId: useShopStore.getState().selectedShopId,
    });
  }
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const shopId = useShopStore.getState().selectedShopId;
  if (shopId && !config.headers['x-shop-id']) config.headers['x-shop-id'] = shopId;
  return config;
});

let refreshPromise = null;

/**
 * Response interceptor:
 *  - On 401, tries silently refreshing the access token once (in-flight-safe).
 *  - If refresh fails with 401, we clear the session (token is truly bad).
 *  - Any other failure (network, 5xx) leaves the session alone so a flaky
 *    network can't log the user out.
 */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const url = original?.url || '';
    if (error.response?.data?.error?.code === 'IP_ACCESS_DENIED') {
      hardLogout(error.response.data.error.message);
      return Promise.reject(error);
    }
    if (
      status === 401 &&
      !original._retry &&
      !url.includes('/auth/refresh') &&
      !url.includes('/auth/login')
    ) {
      original._retry = true;
      try {
        if (!refreshPromise) refreshPromise = refreshAccessToken();
        const newToken = await refreshPromise;
        if (newToken) {
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      } catch (refreshError) {
        return Promise.reject(refreshError);
      } finally {
        refreshPromise = null;
      }
    }
    return Promise.reject(error);
  }
);

async function refreshAccessToken() {
  const { refreshToken, setTokens, setIpAccessState } = useAuthStore.getState();
  if (!refreshToken) {
    hardLogout();
    return null;
  }
  try {
    const resp = await axios.post(`${baseURL}/auth/refresh`, {
      refresh_token: refreshToken,
      device_id: getStableDeviceId(),
      device_name: getReadableDeviceName(),
    });
    if (resp.data?.ok) {
      setTokens(resp.data.data.access_token, resp.data.data.refresh_token);
      setIpAccessState(
        resp.data.data.ip_access_restricted || useAuthStore.getState().ipAccessRestricted,
        useAuthStore.getState().ipValidationPending
      );
      return resp.data.data.access_token;
    }
    hardLogout();
  } catch (err) {
    if (err.response?.data?.error?.code === 'IP_ACCESS_DENIED') {
      hardLogout(err.response.data.error.message);
      return null;
    }
    if (err.response?.status === 401) {
      hardLogout();
      return null;
    }
    throw err;
  }
  return null;
}

/**
 * Attempts to validate the stored session on app startup.
 *   - Returns true  → tokens are valid (or were silently refreshed).
 *   - Returns false → no session / refresh token truly invalid.
 * Never throws; network errors keep the user logged in so transient
 * connectivity issues don't bounce them to the login screen.
 */
export async function bootstrapSession() {
  const { accessToken, refreshToken } = useAuthStore.getState();
  if (!accessToken && !refreshToken) return false;

  try {
    const resp = await api.get('/auth/me');
    if (resp.data?.ok) {
      const { user, shops, ip_access_restricted } = resp.data.data;
      useAuthStore.getState().setIpAccessState(ip_access_restricted, false);
      if (Array.isArray(shops) && shops.length) {
        useShopStore.getState().setShops(shops);
      }
      const selectedShopId = useShopStore.getState().selectedShopId;
      const selectedShop = shops?.find((shop) => shop.id === selectedShopId);
      useAuthStore.getState().setUser({
        ...user,
        permissions: selectedShop?.shop_permissions || user.permissions,
      });
      return true;
    }
  } catch (err) {
    if (err.response?.status === 401) {
      hardLogout();
      return false;
    }
    if (err.response?.data?.error?.code === 'IP_ACCESS_DENIED') return false;
    if (useAuthStore.getState().ipAccessRestricted) {
      useAuthStore.getState().setIpValidationPending(true);
      return false;
    }
  }
  return !!useAuthStore.getState().accessToken;
}

export function unwrap(response) {
  if (!response?.data?.ok) {
    const msg = response?.data?.error?.message || 'Request failed';
    throw new Error(msg);
  }
  return response.data;
}
