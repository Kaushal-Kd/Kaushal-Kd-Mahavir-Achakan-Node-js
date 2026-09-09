import crypto from 'node:crypto';

import { env } from '../config/env.js';

/**
 * Google Cloud Storage service (requirements §72).
 *
 * - Lazy-loads `@google-cloud/storage` so the backend still boots when the
 *   package is not installed yet (during dev / initial clone).
 * - Uses either an inline credentials object (CI) or a key-file path (local).
 * - All uploads go through V4 signed URLs so API bandwidth never touches
 *   the image payload.
 */

let bucketPromise = null;

async function getBucket() {
  if (!env.GCS_ENABLED) {
    const err = new Error('GCS is not configured on this server');
    err.statusCode = 503;
    throw err;
  }
  if (!env.GCS_BUCKET_NAME) {
    const err = new Error('GCS_BUCKET_NAME is not set');
    err.statusCode = 503;
    throw err;
  }
  if (!bucketPromise) {
    bucketPromise = (async () => {
      let Storage;
      try {
        ({ Storage } = await import('@google-cloud/storage'));
      } catch (e) {
        const err = new Error(
          'Install "@google-cloud/storage" in apps/backend to enable GCS uploads'
        );
        err.statusCode = 503;
        err.cause = e;
        throw err;
      }
      const storage = new Storage({
        projectId: env.GCS_PROJECT_ID || env.GCS_CREDENTIALS?.projectId || undefined,
        credentials: env.GCS_CREDENTIALS?.credentials,
      });
      return storage.bucket(env.GCS_BUCKET_NAME);
    })();
  }
  return bucketPromise;
}

/** @param {string} s */
function sanitizeFolder(s) {
  return String(s || 'misc')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 80);
}

const ZIP_CONTENT_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
]);

/** Normalize browser/OS zip MIME variants to application/zip for signing. */
export function normalizeUploadContentType(contentType) {
  const m = String(contentType || '').toLowerCase().trim();
  if (ZIP_CONTENT_TYPES.has(m)) return 'application/zip';
  return m;
}

function isAllowedUploadContentType(contentType) {
  const normalized = normalizeUploadContentType(contentType);
  if (env.GCS_UPLOAD_ALLOWED_MIME.length === 0) return true;
  if (env.GCS_UPLOAD_ALLOWED_MIME.includes(normalized)) return true;
  if (normalized === 'application/zip') {
    return env.GCS_UPLOAD_ALLOWED_MIME.some((allowed) => ZIP_CONTENT_TYPES.has(allowed));
  }
  return false;
}

/** @param {string} mime */
function extensionForMime(mime) {
  const m = normalizeUploadContentType(mime);
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/zip') return 'zip';
  return 'bin';
}

/**
 * Build a canonical object path: <folder>/<shopId>/<yyyy>/<mm>/<uuid>.<ext>
 * Grouping by date + shop keeps the bucket listable even at millions of objects.
 */
export function buildObjectPath({ folder, shopId, mime }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = crypto.randomUUID();
  const ext = extensionForMime(mime);
  const safeFolder = sanitizeFolder(folder);
  const safeShop = sanitizeFolder(shopId || 'shared');
  return `${safeFolder}/${safeShop}/${yyyy}/${mm}/${id}.${ext}`;
}

/**
 * Create a V4 signed URL the client can PUT directly to. Size and content-type
 * are enforced: a client that uses a different content-type will be rejected
 * by GCS.
 *
 * @param {{ folder?: string, shopId?: string, contentType: string, size?: number }} opts
 * @returns {Promise<{ objectPath: string, uploadUrl: string, publicUrl: string, expiresAt: string }>}
 */
export async function createSignedUploadUrl(opts) {
  const { folder = 'misc', shopId } = opts;
  const rawContentType = opts.contentType;
  if (!rawContentType) {
    const err = new Error('content_type is required');
    err.statusCode = 400;
    throw err;
  }
  const contentType = normalizeUploadContentType(rawContentType);
  if (!isAllowedUploadContentType(rawContentType)) {
    const err = new Error(`Content-type not allowed: ${rawContentType}`);
    err.statusCode = 400;
    throw err;
  }

  const bucket = await getBucket();
  const objectPath = buildObjectPath({ folder, shopId, mime: contentType });
  const file = bucket.file(objectPath);

  const expiresInMs = 10 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiresInMs);
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: expiresAt,
    contentType,
  });

  const publicUrl = env.GCS_CDN_URL
    ? `${env.GCS_CDN_URL.replace(/\/+$/, '')}/${objectPath}`
    : `https://storage.googleapis.com/${env.GCS_BUCKET_NAME}/${objectPath}`;

  return {
    objectPath,
    uploadUrl,
    publicUrl,
    expiresAt: expiresAt.toISOString(),
  };
}

export function publicUrlForObjectPath(objectPath) {
  return env.GCS_CDN_URL
    ? `${env.GCS_CDN_URL.replace(/\/+$/, '')}/${objectPath}`
    : `https://storage.googleapis.com/${env.GCS_BUCKET_NAME}/${objectPath}`;
}

/**
 * Create a V4 signed URL the client can GET (for private buckets).
 * @param {string} objectPath
 * @param {number} [ttlSeconds]
 */
export async function createSignedReadUrl(objectPath, ttlSeconds) {
  const bucket = await getBucket();
  const ttl = Number(ttlSeconds || env.GCS_SIGNED_URL_EXPIRY_SECONDS || 3600);
  const [url] = await bucket.file(objectPath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + ttl * 1000,
  });
  return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

/** @param {string} objectPath */
export async function deleteObject(objectPath) {
  const bucket = await getBucket();
  await bucket.file(objectPath).delete({ ignoreNotFound: true });
}

/** @param {string} objectPath */
export async function readObjectBuffer(objectPath) {
  const bucket = await getBucket();
  const [buffer] = await bucket.file(objectPath).download();
  return buffer;
}

/**
 * @param {string} objectPath
 * @param {Buffer} buffer
 * @param {string} contentType
 */
export async function uploadObjectBuffer(objectPath, buffer, contentType) {
  const bucket = await getBucket();
  await bucket.file(objectPath).save(buffer, {
    resumable: false,
    contentType,
    metadata: { contentType },
  });
}

export const gcsInfo = Object.freeze({
  get enabled() {
    return env.GCS_ENABLED;
  },
  get bucket() {
    return env.GCS_BUCKET_NAME;
  },
  get projectId() {
    return env.GCS_PROJECT_ID;
  },
  get clientEmail() {
    return env.GCS_CREDENTIALS?.clientEmail || null;
  },
});
