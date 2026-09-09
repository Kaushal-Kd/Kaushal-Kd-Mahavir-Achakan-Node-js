const DEVICE_ID_KEY = 'wrs.device_id';

function fallbackUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function getStableDeviceId() {
  if (typeof localStorage === 'undefined') return 'unknown-device';
  const stored = String(localStorage.getItem(DEVICE_ID_KEY) || '').trim();
  if (stored) return stored;
  const id = globalThis.crypto?.randomUUID?.() || fallbackUuid();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function getReadableDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Device';
  const browser = navigator.userAgent.includes('Edg/')
    ? 'Edge'
    : navigator.userAgent.includes('Chrome/')
      ? 'Chrome'
      : navigator.userAgent.includes('Firefox/')
        ? 'Firefox'
        : 'App';
  return `${platform} · ${browser}`.slice(0, 200);
}
