const LOCAL_API = 'http://localhost:4000/api';

function isLocalHostname(hostname) {
  return /^(localhost|127\.0\.0\.1)$/i.test(String(hostname || ''));
}

function localApiForHost(hostname) {
  return `http://${hostname}:4000/api`;
}

function rewriteLocalApiHost(url, hostname) {
  return String(url).replace(/^https?:\/\/(localhost|127\.0\.0\.1)/i, (match) => {
    const protocol = match.split('://')[0];
    return `${protocol}://${hostname}`;
  });
}

/**
 * Browser local Vite (`localhost` / `127.0.0.1`) talks to the backend on the
 * same loopback hostname the page used, so CORS and cookies stay same-site.
 * Hosted web keeps same-origin `/api`. Electron `file://` uses the local API.
 */
export function resolveApiBaseUrl({ envUrl, protocol, hostname, origin } = {}) {
  if (envUrl) {
    const isWeb = /^https?:$/.test(protocol || '');
    const pointsToLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(envUrl);
    if (!isWeb || !pointsToLocalhost || isLocalHostname(hostname)) {
      if (isLocalHostname(hostname) && pointsToLocalhost) return rewriteLocalApiHost(envUrl, hostname);
      return envUrl;
    }
  }

  if (isLocalHostname(hostname)) return localApiForHost(hostname);

  if (/^https?:$/.test(protocol || '') && origin) {
    return `${String(origin).replace(/\/$/, '')}/api`;
  }

  return LOCAL_API;
}
