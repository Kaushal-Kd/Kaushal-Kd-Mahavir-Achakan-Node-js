import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { createServer } from 'vite';

let server;
let Sidebar;
let authState;
let uiState;
const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;

before(async () => {
  // In-memory fixtures only: these checks never use an account or call the backend.
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  server = await createServer({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    configFile: false,
    envFile: false,
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: { '@wrs/shared': fileURLToPath(new URL('../../../../../packages/shared/src', import.meta.url)) },
    },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ default: Sidebar } = await server.ssrLoadModule('/src/components/layout/Sidebar.jsx'));
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/authStore.js');
  const { useUIStore } = await server.ssrLoadModule('/src/stores/uiStore.js');
  // React SSR reads Zustand's initial snapshot, not the mounted client snapshot.
  authState = useAuthStore.getInitialState();
  uiState = useUIStore.getInitialState();
});

after(async () => {
  await server?.close();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

function renderSidebar({ collapsed = true, mobile = false, route = '/', user = { role: 'super_admin' } } = {}) {
  globalThis.window = { matchMedia: () => ({ matches: !mobile }) };
  authState.user = user;
  uiState.sidebarCollapsed = collapsed;
  uiState.mobileNavOpen = mobile;
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, gcTime: Infinity } } });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
      createElement(StaticRouter, { location: route }, createElement(Sidebar))));
  } finally {
    queryClient.clear();
  }
}

test('collapsed desktop retains a narrow, scrollable icon sidebar and expand control', () => {
  const html = renderSidebar();
  assert.match(html, /aria-label="Collapsed sidebar"/);
  assert.match(html, /w-16 shrink-0/);
  assert.match(html, /overflow-y-auto/);
  assert.match(html, /aria-label="Show side menu"/);
  assert.match(html, /aria-label="Dashboard"/);
  assert.match(html, /aria-label="Check Availability"/);
  assert.match(html, /aria-label="Products Available"/);
  for (const section of ['Master', 'Inventory', 'Transaction', 'General Report', 'Finance Report', 'Settings']) {
    assert.ok(html.includes(`aria-label="Expand ${section} menu"`));
  }
  assert.doesNotMatch(html, /<span[^>]*>Dashboard<\/span>/);
});

test('collapsed icons keep direct destinations and highlight the current route', () => {
  const html = renderSidebar({ route: '/products-available' });
  assert.match(html, /aria-label="Products Available"[^>]*aria-current="page"[^>]*href="\/products-available"/);
  assert.match(html, /href="\/availability"/);
});

test('collapsed sidebar does not expose sections denied by user permissions', () => {
  const html = renderSidebar({ user: { role: 'salesman', permissions: { dashboard: { view: true } } } });
  assert.match(html, /aria-label="Dashboard"/);
  assert.doesNotMatch(html, /aria-label="Expand Transaction menu"/);
  assert.doesNotMatch(html, /aria-label="Expand Finance Report menu"/);
  assert.doesNotMatch(html, /aria-label="Check Availability"/);
});

test('expanded desktop has a direct collapse control without an extra options menu', () => {
  const html = renderSidebar({ collapsed: false, route: '/sales' });
  assert.doesNotMatch(html, /aria-label="Collapsed sidebar"/);
  assert.match(html, /w-60 shrink-0/);
  assert.match(html, /aria-label="Collapse side menu" aria-expanded="true"/);
  assert.doesNotMatch(html, /aria-haspopup="menu"|role="menuitem"|Collapse to icons/);
  assert.match(html, /<span[^>]*>Sale<\/span>/);
});

test('mobile drawer ignores the persisted desktop collapsed state', () => {
  const html = renderSidebar({ mobile: true, collapsed: true });
  assert.doesNotMatch(html, /aria-label="Collapsed sidebar"/);
  assert.match(html, /aria-label="Close menu"/);
  assert.match(html, /translate-x-0/);
  assert.match(html, /<span[^>]*>Dashboard<\/span>/);
});
