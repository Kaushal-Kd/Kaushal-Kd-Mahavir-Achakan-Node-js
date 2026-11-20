/**
 * Quick offline check of the local visual-search model.
 *   node scripts/visual-search-selftest.mjs samples.json
 * samples.json: [{ name, cat, image_url }] — each photo is embedded, then a
 * slightly altered copy (crop + brightness, like a phone scan) is matched back.
 */
import fs from 'node:fs';

import sharp from 'sharp';

const { embedImage, visualModelAvailable } = await import('../src/modules/accessories/visualSearchService.js');

const samples = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!visualModelAvailable()) throw new Error('model missing');
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

const catalog = [];
let t0 = Date.now();
for (const s of samples) {
  const buf = Buffer.from(await (await fetch(s.image_url)).arrayBuffer());
  catalog.push({ ...s, buf, vec: await embedImage(buf) });
}
console.log(`embedded ${catalog.length} catalog photos, ${Math.round((Date.now() - t0) / catalog.length)} ms each`);

let top1 = 0;
for (const item of catalog) {
  const meta = await sharp(item.buf).metadata();
  const w = meta.width || 400;
  const h = meta.height || 400;
  const scan = await sharp(item.buf)
    .extract({ left: Math.round(w * 0.08), top: Math.round(h * 0.08), width: Math.round(w * 0.84), height: Math.round(h * 0.84) })
    .modulate({ brightness: 0.85 })
    .rotate(8, { background: '#dddddd' })
    .jpeg({ quality: 70 })
    .toBuffer();
  const q = await embedImage(scan);
  const ranked = catalog.map((c) => ({ name: c.name, score: dot(q, c.vec) })).sort((a, b) => b.score - a.score);
  if (ranked[0].name === item.name) top1 += 1;
  console.log(`${item.cat.padEnd(5)} ${item.name.slice(0, 32).padEnd(32)} -> ${ranked[0].name.slice(0, 32)} (${ranked[0].score.toFixed(3)}), 2nd ${ranked[1].score.toFixed(3)}`);
}
console.log(`top-1 match: ${top1}/${catalog.length}`);
process.exit(0);
