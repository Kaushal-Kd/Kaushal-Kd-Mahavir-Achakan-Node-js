/** Browser/CDN cache for immutable GCS objects (originals and thumbs). */
export const GCS_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const IMAGE_EXT = /^(jpe?g|png|webp|gif)$/i;

function stripUrlSuffix(url) {
  const raw = String(url || '').trim();
  const q = raw.indexOf('?');
  const h = raw.indexOf('#');
  let cut = -1;
  if (q >= 0) cut = q;
  if (h >= 0 && (cut < 0 || h < cut)) cut = h;
  return cut >= 0 ? raw.slice(0, cut) : raw;
}

/**
 * Sibling thumb object for an original GCS path.
 * `folder/shop/2024/01/uuid.jpg` → `folder/shop/2024/01/uuid.thumb.webp`
 *
 * @param {string} objectPath
 * @returns {string}
 */
export function thumbObjectPathFromOriginal(objectPath) {
  const raw = String(objectPath || '').trim();
  if (!raw || raw.includes('.thumb.')) return raw;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = raw.slice(dot + 1);
  if (!IMAGE_EXT.test(ext)) return '';
  return `${raw.slice(0, dot)}.thumb.webp`;
}

/**
 * Only `.thumb.webp` objects may be signed via client-supplied object_path.
 * @param {string} objectPath
 * @returns {boolean}
 */
export function isSafeThumbObjectPath(objectPath) {
  const p = String(objectPath || '');
  if (!p || p.startsWith('/') || p.includes('..') || p.includes('//')) return false;
  return /^[a-z0-9][a-z0-9/_-]*\.thumb\.webp$/.test(p);
}

/**
 * List/grid display URL. Signed URLs (query string) stay on the original.
 * Missing thumbs are handled by SmartImage falling back to the original.
 *
 * @param {string} url
 * @returns {string}
 */
export function thumbUrlForImage(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.includes('?') || raw.includes('#')) return raw;
  const pathname = stripUrlSuffix(raw);
  if (pathname.includes('.thumb.')) return raw;
  const dot = pathname.lastIndexOf('.');
  if (dot <= 0) return raw;
  const ext = pathname.slice(dot + 1);
  if (!IMAGE_EXT.test(ext)) return raw;
  return `${pathname.slice(0, dot)}.thumb.webp`;
}
