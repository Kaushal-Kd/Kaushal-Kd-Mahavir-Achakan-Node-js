import { GoogleAuth } from 'google-auth-library';
import sharp from 'sharp';

import { env } from '../../config/env.js';
import knex from '../../db/knex.js';
import { badRequest } from '../../utils/errors.js';

const MODEL = 'multimodalembedding@001';
const MAX_QUERY_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_IMAGE_BYTES = 10 * 1024 * 1024;
const INDEX_BATCH_SIZE = 16;

function parseEmbedding(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

export function cosineSimilarity(left, right) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function visualSearchConfigured() {
  return Boolean(env.VERTEX_VISUAL_SEARCH_ENABLED && env.VERTEX_VISUAL_SEARCH_PROJECT_ID);
}

function decodeImageDataUrl(value) {
  const match = String(value || '').match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
  );
  if (!match) throw badRequest('Upload a JPEG, PNG, or WebP image');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_QUERY_BYTES) {
    throw badRequest('Visual-search image must be 2 MB or smaller');
  }
  return buffer;
}

function allowedImageHosts() {
  const hosts = new Set(['storage.googleapis.com']);
  try {
    if (env.GCS_CDN_URL) hosts.add(new URL(env.GCS_CDN_URL).hostname);
  } catch {
    // Invalid optional CDN configuration is ignored; private-network fetches remain blocked.
  }
  return hosts;
}

async function downloadCatalogImage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Catalog image URL is invalid');
  }
  if (parsed.protocol !== 'https:' || !allowedImageHosts().has(parsed.hostname)) {
    throw new Error('Catalog image host is not approved for visual indexing');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(parsed, { signal: controller.signal });
    if (!response.ok) throw new Error(`Catalog image returned HTTP ${response.status}`);
    if (!String(response.headers.get('content-type') || '').startsWith('image/')) {
      throw new Error('Catalog URL is not an image');
    }
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_CATALOG_IMAGE_BYTES) throw new Error('Catalog image is too large');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_CATALOG_IMAGE_BYTES) {
      throw new Error('Catalog image is too large');
    }
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function vertexEmbedding(imageBuffer) {
  const vertexImage = await sharp(imageBuffer)
    .rotate()
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();
  const auth = new GoogleAuth({
    credentials: env.GCS_CREDENTIALS?.credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error('Google Cloud credentials could not obtain an access token');
  const location = env.VERTEX_VISUAL_SEARCH_LOCATION;
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${env.VERTEX_VISUAL_SEARCH_PROJECT_ID}/locations/${location}/publishers/google/models/${MODEL}:predict`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [
        {
          image: {
            bytesBase64Encoded: vertexImage.toString('base64'),
            mimeType: 'image/jpeg',
          },
        },
      ],
      parameters: { dimension: 512 },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vertex visual embedding failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const payload = await response.json();
  const embedding = parseEmbedding(payload?.predictions?.[0]?.imageEmbedding);
  if (!embedding.length) throw new Error('Vertex returned no image embedding');
  return embedding;
}

async function indexCandidate(candidate) {
  const image = await downloadCatalogImage(candidate.main_image);
  const embedding = await vertexEmbedding(image);
  await knex('product_visual_embeddings')
    .insert({
      product_id: candidate.id,
      shop_id: candidate.shop_id,
      source_image_url: candidate.main_image,
      model: MODEL,
      embedding: JSON.stringify(embedding),
      indexed_at: knex.fn.now(),
    })
    .onConflict('product_id')
    .merge({
      shop_id: candidate.shop_id,
      source_image_url: candidate.main_image,
      model: MODEL,
      embedding: JSON.stringify(embedding),
      indexed_at: knex.fn.now(),
    });
}

export function getVisualSearchStatus() {
  return {
    enabled: visualSearchConfigured(),
    provider: 'Google Vertex AI',
    model: MODEL,
  };
}

export async function searchProductsByImage(shopId, imageDataUrl) {
  if (!visualSearchConfigured()) {
    throw badRequest('Visual search is not configured for this server');
  }
  const queryEmbedding = await vertexEmbedding(decodeImageDataUrl(imageDataUrl));
  const candidates = await knex('products as p')
    .leftJoin('product_visual_embeddings as pve', 'pve.product_id', 'p.id')
    .where({ 'p.shop_id': shopId, 'p.is_active': true })
    .whereNotNull('p.main_image')
    .whereNot('p.main_image', '')
    .select(
      'p.id',
      'p.shop_id',
      'p.main_image',
      'pve.source_image_url',
      'pve.model',
      'pve.embedding'
    );

  const stale = candidates
    .filter(
      (candidate) =>
        !parseEmbedding(candidate.embedding).length ||
        candidate.model !== MODEL ||
        candidate.source_image_url !== candidate.main_image
    )
    .slice(0, INDEX_BATCH_SIZE);
  const indexed = await Promise.allSettled(stale.map(indexCandidate));
  const refreshed = await knex('product_visual_embeddings')
    .where({ shop_id: shopId, model: MODEL })
    .whereIn(
      'product_id',
      candidates.map((candidate) => candidate.id)
    )
    .select('product_id', 'source_image_url', 'model', 'embedding');
  const currentImageByProduct = new Map(
    candidates.map((candidate) => [candidate.id, candidate.main_image])
  );
  const currentEmbeddings = refreshed.filter(
    (row) =>
      row.model === MODEL && row.source_image_url === currentImageByProduct.get(row.product_id)
  );
  const matches = currentEmbeddings
    .map((row) => ({
      product_id: row.product_id,
      score: cosineSimilarity(queryEmbedding, parseEmbedding(row.embedding)),
    }))
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  return {
    matches,
    indexed_count: currentEmbeddings.length,
    catalog_image_count: candidates.length,
    indexed_this_search: indexed.filter((result) => result.status === 'fulfilled').length,
    remaining_to_index: Math.max(0, candidates.length - currentEmbeddings.length),
  };
}
