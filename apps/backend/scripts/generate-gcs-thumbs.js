#!/usr/bin/env node
/**
 * Generate `.thumb.webp` siblings for existing public GCS images.
 *
 *   node scripts/generate-gcs-thumbs.js --dry-run
 *   node scripts/generate-gcs-thumbs.js --write
 *   node scripts/generate-gcs-thumbs.js --write --limit 100
 */
import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { GCS_CACHE_CONTROL, thumbObjectPathFromOriginal } from '@wrs/shared';

import { env } from '../src/config/env.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CONCURRENCY = 8;

const args = new Set(process.argv.slice(2));
const doWrite = args.has('--write');
const limitArg = process.argv.find((a, i, all) => all[i - 1] === '--limit');
const limit = limitArg ? Number(limitArg) : 0;

function storageClient() {
  if (!env.GCS_BUCKET_NAME) {
    throw new Error('GCS_BUCKET_NAME is not set');
  }
  return new Storage({
    projectId: env.GCS_PROJECT_ID || env.GCS_CREDENTIALS?.projectId || undefined,
    credentials: env.GCS_CREDENTIALS?.credentials,
  });
}

async function listNames(bucket) {
  const names = [];
  let pageToken;
  do {
    const [page, , response] = await bucket.getFiles({
      autoPaginate: false,
      pageToken,
    });
    for (const file of page) names.push(file.name);
    pageToken = response?.nextPageToken;
  } while (pageToken);
  return names;
}

async function mapPool(items, worker) {
  let index = 0;
  const n = Math.min(CONCURRENCY, Math.max(1, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    })
  );
}

async function main() {
  const storage = storageClient();
  const bucket = storage.bucket(env.GCS_BUCKET_NAME);
  const names = await listNames(bucket);
  const nameSet = new Set(names);

  const originals = names.filter((name) => {
    if (!name || name.includes('.thumb.') || name.endsWith('/')) return false;
    if (!IMAGE_EXT.test(name)) return false;
    const thumb = thumbObjectPathFromOriginal(name);
    if (!thumb || thumb === name) return false;
    return !nameSet.has(thumb);
  });

  const queued = limit > 0 ? originals.slice(0, limit) : originals;
  console.log(
    JSON.stringify(
      {
        bucket: env.GCS_BUCKET_NAME,
        objects: names.length,
        missing_thumbs: originals.length,
        queued: queued.length,
        mode: doWrite ? 'write' : 'dry-run',
      },
      null,
      2
    )
  );

  if (!doWrite || queued.length === 0) return;

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  await mapPool(queued, async (name) => {
    const thumbPath = thumbObjectPathFromOriginal(name);
    try {
      const file = bucket.file(name);
      const [meta] = await file.getMetadata();
      const contentType = String(meta.contentType || '').toLowerCase();
      if (contentType && !IMAGE_TYPES.has(contentType) && contentType !== 'application/octet-stream') {
        skipped += 1;
        return;
      }
      const [buffer] = await file.download();
      const thumbBuf = await sharp(buffer)
        .rotate()
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      await bucket.file(thumbPath).save(thumbBuf, {
        resumable: false,
        metadata: {
          contentType: 'image/webp',
          cacheControl: GCS_CACHE_CONTROL,
        },
      });
      ok += 1;
      if (ok % 50 === 0) {
        console.log(`thumbs written: ${ok}/${queued.length}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`failed ${name}: ${err?.message || err}`);
    }
  });

  console.log(JSON.stringify({ written: ok, skipped, failed }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
