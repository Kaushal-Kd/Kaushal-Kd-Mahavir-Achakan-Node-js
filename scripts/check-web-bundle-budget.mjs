import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'apps/desktop/dist');
const indexPath = resolve(dist, 'index.html');

if (!existsSync(indexPath)) {
  console.error('Desktop build is missing. Run npm run build:desktop first.');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
const preloadPaths = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(
  (match) => match[1]
);
const cssPaths = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((path) => path.includes('/assets/'));

if (!entryMatch) {
  console.error('Could not find the production module entry in dist/index.html.');
  process.exit(1);
}

const entryPath = entryMatch[1];
const criticalPaths = [...new Set([entryPath, ...preloadPaths, ...cssPaths])];
const diskPath = (assetPath) => resolve(dist, assetPath.replace(/^\.\//, '').replace(/^\//, ''));
const gzipBytes = (assetPath) => gzipSync(readFileSync(diskPath(assetPath)), { level: 9 }).length;
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const entryGzip = gzipBytes(entryPath);
const criticalGzip = criticalPaths.reduce((total, assetPath) => total + gzipBytes(assetPath), 0);
const forbiddenPreloads = preloadPaths.filter((assetPath) =>
  /(pdf-|BarcodeScannerModal|DashboardChart)/i.test(basename(assetPath))
);
const startupSources = criticalPaths.flatMap((assetPath) => {
  if (!assetPath.endsWith('.js')) return [];
  const sourceMapPath = `${diskPath(assetPath)}.map`;
  if (!existsSync(sourceMapPath)) return [];
  return JSON.parse(readFileSync(sourceMapPath, 'utf8')).sources || [];
});
const startupZodSources = startupSources.filter((source) =>
  /(?:node_modules\/zod|packages\/shared\/src\/schemas)/i.test(source.replaceAll('\\', '/'))
);

const failures = [];
if (entryGzip > 100 * 1024) {
  failures.push(`entry gzip is ${kb(entryGzip)} KB (budget: 100 KB)`);
}
if (criticalGzip > 250 * 1024) {
  failures.push(`critical gzip is ${kb(criticalGzip)} KB (budget: 250 KB)`);
}
if (forbiddenPreloads.length) {
  failures.push(
    `deferred chunks were preloaded: ${forbiddenPreloads
      .map((assetPath) => basename(assetPath))
      .join(', ')}`
  );
}
if (startupZodSources.length) {
  failures.push('Zod or shared schemas are included in the startup graph');
}

console.log(`Entry gzip: ${kb(entryGzip)} KB`);
console.log(`Critical JS + CSS gzip: ${kb(criticalGzip)} KB`);
console.log(
  `Critical assets: ${criticalPaths.map((assetPath) => basename(assetPath)).join(', ')}`
);

if (failures.length) {
  console.error(`Bundle budget failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
