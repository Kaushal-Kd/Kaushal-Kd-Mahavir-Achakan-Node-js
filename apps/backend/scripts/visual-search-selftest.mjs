/**
 * Offline accuracy check of the local visual-search model on real catalog photos.
 *   node scripts/visual-search-selftest.mjs samples.json
 * samples.json: [{ name, cat, image_url }]. Each catalog photo is indexed like
 * production; then a phone-like scan is simulated (watermark blurred, item placed
 * small on a wooden counter, tilted, darker, blurred, low-quality JPEG) and
 * matched back within its category.
 */
import fs from 'node:fs';

import sharp from 'sharp';

const { embedCatalogImage, embedQueryImage, visualModelAvailable } = await import(
  '../src/modules/accessories/visualSearchService.js'
);

const samples = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!visualModelAvailable()) throw new Error('model missing — run scripts/download-visual-model.mjs');
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

async function phoneLike(buf) {
  const base = await sharp(buf).flatten({ background: '#ffffff' }).png().toBuffer();
  const { width: w, height: h } = await sharp(base).metadata();
  const r = Math.round(Math.min(w, h) * 0.24);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="white"/></svg>`);
  const blurred = await sharp(await sharp(base).blur(18).png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const composed = await sharp(base).composite([{ input: blurred }]).png().toBuffer();
  const unmarked = await sharp(composed).trim({ threshold: 25 }).png().toBuffer();
  const item = await sharp(unmarked).rotate(7, { background: '#7a5a3a' }).resize(320, 320, { fit: 'contain', background: '#7a5a3a' })
    .modulate({ brightness: 0.82, saturation: 1.1 }).blur(1).toBuffer();
  return sharp({ create: { width: 540, height: 540, channels: 3, background: '#8a6a48' } })
    .composite([{ input: item, left: 120, top: 95 }]).jpeg({ quality: 60 }).toBuffer();
}

const catalog = [];
const t0 = Date.now();
for (const s of samples) {
  const buf = Buffer.from(await (await fetch(s.image_url)).arrayBuffer());
  catalog.push({ ...s, buf, vec: await embedCatalogImage(buf) });
}
console.log(`indexed ${catalog.length} photos, ${Math.round((Date.now() - t0) / catalog.length)} ms each`);

let top1 = 0;
let top5 = 0;
const t1 = Date.now();
for (const item of catalog) {
  const qs = await embedQueryImage(await phoneLike(item.buf));
  const ranked = catalog
    .filter((c) => c.cat === item.cat)
    .map((c) => ({ name: c.name, score: Math.max(...qs.map((q) => dot(q, c.vec))) }))
    .sort((a, b) => b.score - a.score);
  const pos = ranked.findIndex((r) => r.name === item.name);
  if (pos === 0) top1 += 1;
  if (pos >= 0 && pos < 5) top5 += 1;
}
console.log(`scan ${Math.round((Date.now() - t1) / catalog.length)} ms each — top-1 ${top1}/${catalog.length}, top-5 ${top5}/${catalog.length}`);
process.exit(0);
