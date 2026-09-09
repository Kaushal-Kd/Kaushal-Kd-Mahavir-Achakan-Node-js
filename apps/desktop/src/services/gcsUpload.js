import { api, unwrap } from '../lib/api.js';
import { compressImageFile } from '../utils/compressImage.js';

import { IMAGE_UPLOAD_MAX_KB } from './imagePickWithCrop.js';
import { putWithProgress } from './uploadRequest.js';

/**
 * Client-side uploader for Google Cloud Storage (requirements \u00a772).
 *
 * Flow:
 *   1) Ask the backend for a V4 signed URL \u2192 `POST /api/uploads/signed-url`.
 *   2) PUT the file bytes directly to GCS with that signed URL. API bandwidth
 *      is never touched by the payload.
 *   3) Store the returned `object_path` on the entity; render via `public_url`
 *      (or request `/api/uploads/read-url` for private buckets).
 *
 * The request includes content-type and size so the backend can enforce
 * MIME allow-list and max-size limits before signing. GCS itself rejects
 * any PUT that uses a different content-type than the one that was signed.
 */

const FALLBACK_CONTENT_TYPE = 'application/octet-stream';
const MAX_UPLOAD_BYTES = IMAGE_UPLOAD_MAX_KB * 1024;

/**
 * @param {File|Blob} file
 * @param {{
 *   folder?: string,
 *   contentType?: string,
 *   onProgress?: (pct: number) => void,
 *   signal?: AbortSignal,
 *   compress?: boolean,
 * }} [options]
 * @returns {Promise<{ objectPath: string, publicUrl: string, expiresAt: string }>}
 */
export async function uploadToGCS(file, options = {}) {
  if (!file) throw new Error('No file provided');
  const {
    folder = 'products',
    contentType: requestedContentType,
    onProgress,
    signal,
    compress = true,
  } = options;
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  let uploadFile = file;
  if (compress && file.type?.startsWith('image/')) {
    uploadFile = await compressImageFile(file, {
      onProgress: onProgress ? (pct) => onProgress(Math.round(pct * 0.15)) : undefined,
    });
  }

  // Only meaningful for images we actually tried to compress. Non-image
  // payloads (e.g. bulk-import ZIPs uploaded with compress:false) are bounded
  // by the server's own GCS_UPLOAD_MAX_BYTES check instead.
  if (compress && file.type?.startsWith('image/') && (uploadFile.size || 0) > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Image is still over ${IMAGE_UPLOAD_MAX_KB} KB after compression. Try a smaller photo.`
    );
  }

  const contentType = requestedContentType || uploadFile.type || FALLBACK_CONTENT_TYPE;

  const signed = await api
    .post('/uploads/signed-url', {
      folder,
      content_type: contentType,
      size: uploadFile.size || 0,
    }, { signal })
    .then(unwrap);

  const {
    upload_url: uploadUrl,
    object_path: objectPath,
    public_url: publicUrl,
    expires_at: expiresAt,
  } = signed.data;

  await putWithProgress(uploadUrl, uploadFile, contentType, {
    onProgress: onProgress
      ? (pct) => onProgress(Math.min(100, 15 + Math.round(pct * 0.85)))
      : undefined,
    signal,
  });

  return { objectPath, publicUrl, expiresAt };
}

/**
 * Exchange an `object_path` for a short-lived read URL (for private buckets).
 * @param {string} objectPath
 * @param {number} [ttlSeconds]
 * @returns {Promise<{ url: string, expiresAt: string }>}
 */
export async function getReadUrl(objectPath, ttlSeconds) {
  const r = await api
    .post('/uploads/read-url', { object_path: objectPath, ttl_seconds: ttlSeconds })
    .then(unwrap);
  return { url: r.data.url, expiresAt: r.data.expiresAt };
}

/** @param {string} objectPath */
export async function deleteFromGCS(objectPath) {
  await api.delete('/uploads', { data: { object_path: objectPath } }).then(unwrap);
}

/**
 * Lightweight status probe for the integrations page.
 * @returns {Promise<{ enabled: boolean, bucket: string, project_id: string, client_email: string, max_bytes: number, allowed_mime: string[] }>}
 */
export async function getGcsStatus() {
  const r = await api.get('/uploads/status').then(unwrap);
  return r.data;
}
