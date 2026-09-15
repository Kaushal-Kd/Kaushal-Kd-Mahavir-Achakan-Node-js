const LOCAL_API = 'http://localhost:4000/api';

function isLocalHostname(hostname) {
  return /^(localhost|127\.0\.0\.1)$/i.test(String(hostname || ''));
}

/**
 * Browser local Vite (`localhost:5173`) has no `/api` routes unless proxied.
 * Hosted web keeps same-origin `/api`. Electron `file://` uses the local API.
 */
export function resolveApiBaseUrl({ envUrl, protocol, hostname, origin } = {}) {
  if (envUrl) {
    const isWeb = /^https?:$/.test(protocol || '');
    const pointsToLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(envUrl);
    if (!isWeb || !pointsToLocalhost || isLocalHostname(hostname)) return envUrl;
  }

  if (isLocalHostname(hostname)) return LOCAL_API;

  if (/^https?:$/.test(protocol || '') && origin) {
    return `${String(origin).replace(/\/$/, '')}/api`;
  }

  return LOCAL_API;
}
