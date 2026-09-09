#!/usr/bin/env node
/**
 * Apply a CORS policy to the configured GCS bucket so the desktop app can
 * PUT directly to signed URLs from the browser (localhost:5173 in dev,
 * `app://.` / `file://` in packaged Electron, and any prod domains listed
 * in CORS_ORIGIN).
 *
 * Run:  npm run gcs:cors --workspace @wrs/backend
 */
import { Storage } from '@google-cloud/storage';

import { env } from '../src/config/env.js';

async function main() {
  if (!env.GCS_ENABLED) {
    console.error('[gcs:cors] GCS is not configured — check GCS_KEY_FILE / GCS_CREDENTIALS_JSON');
    process.exit(1);
  }
  if (!env.GCS_BUCKET_NAME) {
    console.error('[gcs:cors] GCS_BUCKET_NAME is not set');
    process.exit(1);
  }

  const extraOrigins = (env.CORS_ORIGIN || []).filter((o) => o && o !== 'app://.');
  const origins = Array.from(
    new Set([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'https://achakan.instabizweb.com',
      'https://dashboard.achakan.com',
      'app://.',
      ...extraOrigins,
    ])
  );

  const cors = [
    {
      origin: origins,
      method: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      responseHeader: [
        'Content-Type',
        'Content-Length',
        'Content-MD5',
        'Content-Disposition',
        'Cache-Control',
        'x-goog-resumable',
        'x-goog-acl',
        'x-goog-meta-*',
      ],
      maxAgeSeconds: 3600,
    },
  ];

  const storage = new Storage({
    projectId: env.GCS_PROJECT_ID || env.GCS_CREDENTIALS?.projectId || undefined,
    credentials: env.GCS_CREDENTIALS?.credentials,
  });
  const bucket = storage.bucket(env.GCS_BUCKET_NAME);

  console.log(`[gcs:cors] bucket=${env.GCS_BUCKET_NAME}`);
  console.log('[gcs:cors] origins:');
  for (const o of origins) console.log(`  - ${o}`);

  await bucket.setCorsConfiguration(cors);
  const [meta] = await bucket.getMetadata();
  console.log('\n[gcs:cors] applied CORS:');
  console.log(JSON.stringify(meta.cors, null, 2));
  console.log('\n[gcs:cors] Done. Browser uploads should now succeed.');
}

main().catch((err) => {
  console.error('[gcs:cors] failed:', err?.message || err);
  if (err?.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
