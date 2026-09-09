import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let AccessoryCodeHint;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    configFile: false, envFile: false, esbuild: { jsx: 'automatic' },
    server: { middlewareMode: true, watch: null }, appType: 'custom',
  });
  ({ default: AccessoryCodeHint } = await server.ssrLoadModule('/src/pages/accessories/AccessoryCodeHint.jsx'));
});
after(async () => { await server?.close(); });

const render = (props) => renderToStaticMarkup(createElement(AccessoryCodeHint, {
  categoryId: 'category-a', prefix: 'ACC', ...props,
}));

test('last accessory code uses prefix wording because multiple categories may share a series', () => {
  const html = render({ data: { prefix: 'ACC', code: 'ACC0018' } });
  assert.match(html, /Last \/ highest code for prefix ACC/);
  assert.match(html, /ACC0018/);
  assert.doesNotMatch(html, /this category/);
});

test('last accessory code has explicit loading, unavailable and empty states', () => {
  assert.match(render({ loading: true }), /Loading last accessory code/);
  assert.match(render({ error: true }), /Could not load/);
  assert.doesNotMatch(render({ error: true }), /None yet/);
  assert.match(render({ data: { code: null } }), /None yet/);
  assert.equal(render({ categoryId: '' }), '');
  assert.equal(render({ prefix: '' }), '');
});
