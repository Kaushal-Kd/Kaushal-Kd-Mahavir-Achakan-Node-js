/**
 * localhost and 127.0.0.1 are the same machine but different browser origins.
 * Treat a listed host as also allowing its loopback twin.
 */
export function loopbackTwinOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      return url.origin;
    }
    if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost';
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function isAllowedCorsOrigin(origin, allowed) {
  if (!origin) return true;
  const list = Array.isArray(allowed) ? allowed : [];
  if (list.includes('*') || list.includes(origin)) return true;
  const twin = loopbackTwinOrigin(origin);
  return Boolean(twin && list.includes(twin));
}
