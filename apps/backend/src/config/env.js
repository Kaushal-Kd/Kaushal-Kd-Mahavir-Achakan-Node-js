import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

const required = [];
const isProdEnv = process.env.NODE_ENV === 'production';

function req(key, fallback) {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === null || v === '') required.push(key);
  return v;
}

/** @type {string} Absolute path to apps/backend (repo-relative paths resolve from here). */
const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Resolve GCS service-account credentials from either:
 *   1) GCS_CREDENTIALS_JSON — raw or base64-encoded JSON string (CI / container).
 *   2) GCS_KEY_FILE          — file path, absolute or relative to apps/backend.
 *
 * Returns `{ credentials?, keyFilename? }` as accepted by `@google-cloud/storage`,
 * or `null` when no explicit key material is provided. In that case we can still
 * rely on Application Default Credentials (ADC) if the runtime provides them.
 */
function resolveGcsCredentials() {
  const inline = process.env.GCS_CREDENTIALS_JSON;
  if (inline && inline.trim()) {
    const raw = inline.trim();
    const decoded = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    try {
      return { credentials: JSON.parse(decoded), source: 'inline' };
    } catch (e) {
      console.error('[env] GCS_CREDENTIALS_JSON is not valid JSON:', e.message);
    }
  }

  const keyFile = process.env.GCS_KEY_FILE;
  if (keyFile && keyFile.trim()) {
    const resolved = isAbsolute(keyFile) ? keyFile : resolve(BACKEND_ROOT, keyFile);
    try {
      const raw = readFileSync(resolved, 'utf8');
      const credentials = JSON.parse(raw);
      return { credentials, keyFilename: resolved, source: 'file' };
    } catch (e) {
      console.warn(
        `[env] GCS_KEY_FILE could not be loaded from "${resolved}": ${e.message}. Uploads will be disabled.`
      );
    }
  }

  return null;
}

const gcs = resolveGcsCredentials();
const hasAdcHints =
  !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  !!process.env.GOOGLE_CLOUD_PROJECT ||
  !!process.env.GCLOUD_PROJECT;
const hasGcsBucketConfig = !!process.env.GCS_BUCKET_NAME;

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PROD: process.env.NODE_ENV === 'production',
  IS_DEV: (process.env.NODE_ENV || 'development') === 'development',

  PORT: Number(process.env.PORT || 4000),
  HOST: process.env.HOST || '0.0.0.0',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  CORS_ORIGIN: (process.env.CORS_ORIGIN || 'http://localhost:5173,app://.')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  DB_CLIENT: 'mysql2',
  DB_HOST: req('DB_HOST', isProdEnv ? undefined : '127.0.0.1'),
  DB_PORT: Number(process.env.DB_PORT || 3306),
  DB_USER: req('DB_USER', 'root'),
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  DB_NAME: req('DB_NAME', 'wedding_rent_system'),
  DB_POOL_MIN: Number(process.env.DB_POOL_MIN || 2),
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX || 10),

  JWT_SECRET: req('JWT_SECRET', 'dev-only-change-me'),
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || '2h',
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '30d',

  BCRYPT_ROUNDS: Number(process.env.BCRYPT_ROUNDS || 12),

  SHOP_SMTP_ENCRYPTION_KEY: process.env.SHOP_SMTP_ENCRYPTION_KEY || '',

  GCS_PROJECT_ID: process.env.GCS_PROJECT_ID || gcs?.credentials?.project_id || '',
  GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME || '',
  GCS_REGION: process.env.GCS_REGION || 'asia-south1',
  GCS_CDN_URL: process.env.GCS_CDN_URL || '',
  GCS_SIGNED_URL_EXPIRY_SECONDS: Number(process.env.GCS_SIGNED_URL_EXPIRY_SECONDS || 604800),
  GCS_UPLOAD_MAX_BYTES: Number(process.env.GCS_UPLOAD_MAX_BYTES || 10 * 1024 * 1024),
  GCS_UPLOAD_ALLOWED_MIME: (() => {
    const zipMime = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];
    const defaults =
      'image/jpeg,image/png,image/webp,image/gif,application/pdf,application/zip,application/x-zip-compressed';
    const fromEnv = (process.env.GCS_UPLOAD_ALLOWED_MIME || defaults)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return [...new Set([...fromEnv, ...zipMime])];
  })(),
  GCS_CREDENTIALS: gcs
    ? Object.freeze({
        source: gcs.source,
        keyFilename: gcs.keyFilename || null,
        clientEmail: gcs.credentials?.client_email || null,
        projectId: gcs.credentials?.project_id || null,
        /** Raw creds object for @google-cloud/storage. Kept non-enumerable in logs. */
        credentials: gcs.credentials,
      })
    : null,
  // Enable GCS when explicit creds exist, or when bucket config indicates
  // the app should try ADC-based auth (gcloud login / env-provided creds).
  GCS_ENABLED: !!gcs || hasAdcHints || hasGcsBucketConfig,

  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || 'admin@wrs.local',
  SEED_ADMIN_PHONE: process.env.SEED_ADMIN_PHONE || '9999999999',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
  SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME || 'Super Admin',
  SEED_SHOP_NAME: process.env.SEED_SHOP_NAME || 'Main Branch',

  WHATSAPP_AUTH_DIR: resolve(BACKEND_ROOT, process.env.WHATSAPP_AUTH_DIR || 'data/whatsapp-auth'),
});

if (env.IS_PROD && required.length > 0) {
  console.error('[env] Missing required environment variables:', required.join(', '));
  process.exit(1);
}
