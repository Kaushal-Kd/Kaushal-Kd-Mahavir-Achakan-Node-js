/**
 * Self-hosted accessory visual search ("scan an accessory, see look-alikes").
 *
 * An open-source CLIP vision model runs inside this backend (onnxruntime via
 * transformers.js). Every catalog photo and every scan is turned into a 512-number
 * fingerprint; suggestions are the catalog fingerprints closest to the scan.
 * No Google / third-party AI API is called — model files are loaded from disk only.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import knex from '../../db/knex.js';
import { badRequest } from '../../utils/errors.js';

export const VISUAL_MODEL_ID = 'Xenova/clip-vit-base-patch32';
const MODEL_TAG = 'clip-vit-b32-q8';
const IMAGE_SIZE = 224;
const MAX_QUERY_BYTES = 3 * 1024 * 1024;
const MAX_CATALOG_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_SCORE = 0.55;
const SCAN_TTL_MS = 15 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = process.env.VISUAL_MODEL_DIR || path.resolve(here, '../../../models');

let modelPromise = null;
/** shopId -> { rows: Array<{ accessory_id, vec }>, at } */
const shopCache = new Map();
/** scanToken -> { shopId, vec, at } (kept in memory only, for "learn from pick") */
const recentScans = new Map();
const indexingShops = new Set();

export function visualModelAvailable() {
  return fs.existsSync(path.join(MODELS_DIR, VISUAL_MODEL_ID, 'onnx', 'vision_model_quantized.onnx'));
}

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { AutoProcessor, CLIPVisionModelWithProjection, env } = await import(
        '@huggingface/transformers'
      );
      env.localModelPath = MODELS_DIR;
      env.allowLocalModels = true;
      env.allowRemoteModels = false; // never download at runtime
      const processor = await AutoProcessor.from_pretrained(VISUAL_MODEL_ID);
      const model = await CLIPVisionModelWithProjection.from_pretrained(VISUAL_MODEL_ID, {
        dtype: 'q8',
        // One CPU thread so scans never starve the rest of the API on a small server.
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
      });
      const { RawImage } = await import('@huggingface/transformers');
      return { processor, model, RawImage };
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

const toBlob = (vec) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
const fromBlob = (buf) => {
  const b = Buffer.from(buf);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
};

/** Image bytes -> unit-length 512-d fingerprint. */
export async function embedImage(buffer) {
  const { processor, model, RawImage } = await loadModel();
  const { data, info } = await sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'contain', background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
  const inputs = await processor(image);
  const { image_embeds: embeds } = await model(inputs);
  return normalize(embeds.data);
}

function decodeDataUrl(value) {
  const match = String(value || '').match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw badRequest('Upload a JPEG, PNG or WebP image');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_QUERY_BYTES) {
    throw badRequest('Scan image must be 3 MB or smaller');
  }
  return buffer;
}

function allowedImageHosts() {
  const hosts = new Set(['storage.googleapis.com']);
  try {
    if (process.env.GCS_CDN_URL) hosts.add(new URL(process.env.GCS_CDN_URL).hostname);
  } catch {
    // ignore invalid optional CDN URL
  }
  return hosts;
}

async function downloadCatalogImage(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedImageHosts().has(parsed.hostname)) {
    throw new Error('Image host not allowed for indexing');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(parsed, { signal: controller.signal });
    if (!res.ok) throw new Error(`Image returned HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_CATALOG_IMAGE_BYTES) throw new Error('Image too large');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Index accessory photos that have no current fingerprint (or whose photo changed).
 * @param {{ shopId?: string, accessoryId?: string, limit?: number }} [opts]
 */
export async function indexAccessoryImages(opts = {}) {
  if (!visualModelAvailable()) return { indexed: 0, failed: 0, skipped: 'model_missing' };
  const qb = knex('accessories as a')
    .leftJoin('accessory_visual_embeddings as e', function joinCatalog() {
      this.on('e.accessory_id', '=', 'a.id')
        .andOn('e.source', '=', knex.raw('?', ['catalog']))
        .andOn('e.model', '=', knex.raw('?', [MODEL_TAG]));
    })
    .where('a.is_active', true)
    .whereNotNull('a.image_url')
    .whereNot('a.image_url', '')
    .where((w) => w.whereNull('e.id').orWhereRaw('e.image_url <> a.image_url'))
    .select('a.id', 'a.shop_id', 'a.image_url');
  if (opts.shopId) qb.andWhere('a.shop_id', opts.shopId);
  if (opts.accessoryId) qb.andWhere('a.id', opts.accessoryId);
  if (opts.limit) qb.limit(opts.limit);
  const rows = await qb;

  let indexed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const vec = await embedImage(await downloadCatalogImage(row.image_url));
      await knex.transaction(async (trx) => {
        await trx('accessory_visual_embeddings')
          .where({ accessory_id: row.id, source: 'catalog' })
          .del();
        await trx('accessory_visual_embeddings').insert({
          id: randomUUID(),
          shop_id: row.shop_id,
          accessory_id: row.id,
          source: 'catalog',
          image_url: row.image_url,
          model: MODEL_TAG,
          embedding: toBlob(vec),
        });
      });
      shopCache.delete(row.shop_id);
      indexed += 1;
    } catch {
      failed += 1;
    }
  }
  return { indexed, failed, total: rows.length };
}

/** Fire-and-forget indexing (after an accessory photo is saved, or on first scan). */
export function scheduleAccessoryIndexing(opts = {}) {
  const key = opts.accessoryId || opts.shopId || 'all';
  if (indexingShops.has(key) || !visualModelAvailable()) return;
  indexingShops.add(key);
  setImmediate(() => {
    indexAccessoryImages(opts)
      .catch(() => {})
      .finally(() => indexingShops.delete(key));
  });
}

async function loadShopVectors(shopId) {
  const cached = shopCache.get(shopId);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.rows;
  const rows = await knex('accessory_visual_embeddings as e')
    .join('accessories as a', 'a.id', 'e.accessory_id')
    .where({ 'e.shop_id': shopId, 'e.model': MODEL_TAG, 'a.is_active': true })
    .select('e.accessory_id', 'a.category_id', 'e.embedding');
  const parsed = rows.map((r) => ({
    accessory_id: r.accessory_id,
    category_id: r.category_id,
    vec: fromBlob(r.embedding),
  }));
  shopCache.set(shopId, { rows: parsed, at: Date.now() });
  return parsed;
}

function pruneScans() {
  const now = Date.now();
  for (const [token, scan] of recentScans) {
    if (now - scan.at > SCAN_TTL_MS) recentScans.delete(token);
  }
}

/**
 * @param {string} shopId
 * @param {{ image: string, category_id?: string, limit?: number }} body
 */
export async function searchAccessoriesByImage(shopId, body) {
  if (!visualModelAvailable()) {
    throw badRequest('Visual search model is not installed on this server');
  }
  const queryVec = await embedImage(decodeDataUrl(body.image));
  const vectors = await loadShopVectors(shopId);
  if (vectors.length === 0) scheduleAccessoryIndexing({ shopId });

  const best = new Map();
  for (const row of vectors) {
    if (body.category_id && row.category_id !== body.category_id) continue;
    const score = dot(queryVec, row.vec);
    if (score > (best.get(row.accessory_id) ?? -1)) best.set(row.accessory_id, score);
  }
  const limit = Math.min(30, Math.max(1, Number(body.limit) || 12));
  const matches = [...best.entries()]
    .filter(([, score]) => score >= MIN_SCORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([accessory_id, score]) => ({ accessory_id, score: Math.round(score * 1000) / 1000 }));

  pruneScans();
  const scanToken = randomUUID();
  recentScans.set(scanToken, { shopId, vec: queryVec, at: Date.now() });
  return { scan_token: scanToken, matches, indexed_count: vectors.length };
}

/**
 * "Learn from pick": store the scan fingerprint as an extra reference for the
 * accessory the user chose. Only numbers are stored — never the photo.
 */
export async function recordVisualSearchPick(shopId, { scan_token: token, accessory_id: accessoryId }) {
  const scan = recentScans.get(String(token || ''));
  if (!scan || scan.shopId !== shopId) return { saved: false };
  const accessory = await knex('accessories')
    .where({ id: accessoryId, shop_id: shopId })
    .first('id');
  if (!accessory) return { saved: false };
  await knex('accessory_visual_embeddings').insert({
    id: randomUUID(),
    shop_id: shopId,
    accessory_id: accessoryId,
    source: 'scan',
    image_url: null,
    model: MODEL_TAG,
    embedding: toBlob(scan.vec),
  });
  // Keep at most 10 learned scans per accessory.
  const extra = await knex('accessory_visual_embeddings')
    .where({ accessory_id: accessoryId, source: 'scan' })
    .orderBy('created_at', 'desc')
    .offset(10)
    .pluck('id');
  if (extra.length) await knex('accessory_visual_embeddings').whereIn('id', extra).del();
  shopCache.delete(shopId);
  return { saved: true };
}

export async function visualSearchStatus(shopId) {
  const [catalog, withImage] = await Promise.all([
    knex('accessory_visual_embeddings')
      .where({ shop_id: shopId, source: 'catalog', model: MODEL_TAG })
      .count('* as n')
      .first(),
    knex('accessories')
      .where({ shop_id: shopId, is_active: true })
      .whereNotNull('image_url')
      .whereNot('image_url', '')
      .count('* as n')
      .first(),
  ]);
  return {
    enabled: visualModelAvailable(),
    indexed: Number(catalog?.n || 0),
    with_image: Number(withImage?.n || 0),
  };
}
