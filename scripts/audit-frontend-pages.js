/**
 * Simulates frontend page mount API load (parallel fetches per page).
 * Writes docs/perf/frontend-page-report.md and .json
 */

import {
  API_BASE,
  isoTimestamp,
  login,
  monthIso,
  readJsonReport,
  renderFrontendMarkdown,
  request,
  setShopId,
  todayIso,
  writeJsonReport,
  writeMarkdownReport,
} from './perf-report-utils.js';

function buildPageCatalog(today, month) {
  return [
    {
      name: 'Global shell (every route)',
      paths: [
        '/api/drafts?kind=availability_cart',
        '/api/configurations/app-settings',
      ],
    },
    {
      name: 'Dashboard',
      paths: [
        '/api/dashboard',
        '/api/configurations/app-settings',
        '/api/drafts?kind=availability_cart',
        '/api/reminders',
        '/api/custom-orders/trial-reminders',
      ],
    },
    {
      name: 'CreateOrder (create mode)',
      paths: [
        '/api/payment-accounts',
        '/api/security-accounts',
        '/api/time-slots',
        '/api/users?per_page=200',
        '/api/configurations/app-settings',
      ],
    },
    {
      name: 'BookingList',
      paths: [
        '/api/orders?per_page=25&lean=1&with_next_booking_alerts=1&with_audit_summary=1&sort=-created_at',
      ],
    },
    {
      name: 'DeliveryList',
      paths: [
        `/api/orders?per_page=25&date_field=pickup_date&statuses=in_preparation,ready_for_delivery,delivered&sort=-pickup_date&lean=1`,
        '/api/configurations/app-settings',
      ],
    },
    {
      name: 'ReturnList',
      paths: [
        `/api/orders?per_page=25&date_field=return_date&statuses=delivered,partially_returned&sort=-return_date&lean=1`,
        '/api/configurations/app-settings',
      ],
    },
    {
      name: 'ItemToCollectList',
      paths: [
        `/api/orders/items-to-collect?lines=1&per_page=20&skip_enrich=1&pickup_from=${today}&pickup_to=${today}`,
        '/api/categories?type=product',
        '/api/users?per_page=200',
        '/api/configurations/app-settings',
      ],
    },
    {
      name: 'ItemToPrepareList',
      paths: [
        `/api/orders/items-to-prepare?lines=1&per_page=20&skip_enrich=1&pickup_from=${today}&pickup_to=${today}`,
        '/api/categories?type=product',
        '/api/users?per_page=200',
        '/api/configurations/app-settings',
      ],
    },
    {
      name: 'ProductList',
      paths: [
        '/api/products?per_page=25',
        '/api/configurations/colors',
        '/api/configurations/sizes',
        '/api/products/category-counts',
        '/api/categories?type=product',
      ],
    },
  ];
}

async function simulatePage(page, token) {
  const start = performance.now();
  const responses = await Promise.all(
    page.paths.map(async (p) => {
      const r = await request(p, { token });
      return {
        path: p,
        durationMs: r.durationMs,
        payloadBytes: r.payloadBytes,
        status: r.status,
        ok: r.ok,
      };
    })
  );
  const wallMs = Math.round(performance.now() - start);
  const totalBytes = responses.reduce((s, r) => s + r.payloadBytes, 0);
  const slowest = responses.reduce(
    (best, r) => (!best || r.durationMs > best.ms ? { name: r.path, ms: Math.round(r.durationMs) } : best),
    null
  );
  return {
    name: page.name,
    requestCount: responses.length,
    wallMs,
    totalBytes,
    slowest,
    requests: responses,
  };
}

async function main() {
  console.log(`Frontend page audit ${API_BASE}\n`);
  const { token, shopId } = await login();
  setShopId(shopId);
  console.log(`Shop: ${shopId}\n`);

  const today = todayIso();
  const month = monthIso(0);
  const catalog = buildPageCatalog(today, month);

  const pages = [];
  for (const page of catalog) {
    process.stdout.write(`  ${page.name}...`);
    const result = await simulatePage(page, token);
    pages.push(result);
    console.log(` ${result.wallMs}ms (${result.requestCount} reqs)`);
  }

  const pathToPages = new Map();
  for (const p of pages) {
    for (const r of p.requests) {
      if (!pathToPages.has(r.path)) pathToPages.set(r.path, new Set());
      pathToPages.get(r.path).add(p.name);
    }
  }
  const duplicates = [...pathToPages.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([path, set]) => ({ path, pages: [...set] }))
    .sort((a, b) => b.pages.length - a.pages.length);

  const uniquePaths = pathToPages.size;
  const duplicateHits = duplicates.reduce((s, d) => s + d.pages.length - 1, 0);

  const navPages = ['Dashboard', 'BookingList', 'DeliveryList'];
  let navWall = 0;
  let navRequests = 0;
  let navBytes = 0;
  for (const name of navPages) {
    const p = pages.find((x) => x.name === name);
    if (p) {
      navWall += p.wallMs;
      navRequests += p.requestCount;
      navBytes += p.totalBytes;
    }
  }

  const report = {
    generatedAt: isoTimestamp(),
    apiBase: API_BASE,
    shopId,
    pages,
    uniquePaths,
    duplicateHits,
    duplicates,
    navigationScenario: {
      wallMs: navWall,
      requestCount: navRequests,
      totalBytes: navBytes,
    },
  };

  const baseline = readJsonReport('frontend-page-report.baseline.json');
  const mdPath = writeMarkdownReport('frontend-page-report.md', renderFrontendMarkdown(report, baseline));
  const jsonPath = writeJsonReport('frontend-page-report.json', report);

  console.log(`\nReport written:\n  ${mdPath}\n  ${jsonPath}`);
  console.log(`Duplicate API paths: ${duplicates.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
