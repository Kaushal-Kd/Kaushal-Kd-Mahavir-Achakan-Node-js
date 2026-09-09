import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let CompactCatalogFilters;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    configFile: false,
    envFile: false,
    esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ default: CompactCatalogFilters } = await server.ssrLoadModule(
    '/src/components/list/CompactCatalogFilters.jsx'
  ));
});

after(async () => {
  await server?.close();
});

test('bulk filter actions take a wrapping full-width row on narrow screens', () => {
  const html = renderToStaticMarkup(
    createElement(CompactCatalogFilters, {
      onClear() {},
      endActions: createElement('button', null, 'Print selected barcodes'),
    })
  );

  assert.match(
    html,
    /class="flex w-full min-w-0 flex-wrap items-center gap-1\.5 sm:w-auto sm:shrink-0"/
  );
});
