/**
 * Benchmark critical API endpoints (p50/p95 over N runs).
 * Writes docs/perf/backend-api-report.md and .json
 *
 * Usage: see docs/perf/README.md
 */

import { buildBenchmarkCatalog } from './benchmark-api-catalog.js';
import {
  API_BASE,
  BENCH_ORDER_ID,
  BENCH_PRODUCT_ID,
  BENCH_RUNS,
  benchEndpoint,
  login,
  readJsonReport,
  renderBackendMarkdown,
  request,
  setShopId,
  isoTimestamp,
  writeJsonReport,
  writeMarkdownReport,
} from './perf-report-utils.js';

async function main() {
  console.log(`Benchmarking ${API_BASE} (${BENCH_RUNS} runs per endpoint)\n`);
  const { token, shopId } = await login();
  setShopId(shopId);
  console.log(`Shop: ${shopId}\n`);

  const catalog = buildBenchmarkCatalog({
    orderId: BENCH_ORDER_ID,
    productId: BENCH_PRODUCT_ID,
  });

  const results = [];
  for (const entry of catalog) {
    process.stdout.write(`  ${entry.name}...`);
    const row = await benchEndpoint(
      entry.name,
      { group: entry.group, path: entry.path, method: 'GET', risk: entry.risk },
      async () => {
        const r = await request(entry.path, { token });
        if (!r.ok) throw new Error(String(r.status));
        return r;
      }
    );
    results.push(row);
    const icon = row.status === 'pass' ? 'ok' : row.status === 'fail' ? 'SLOW' : 'ERR';
    console.log(` ${icon} p95=${row.p95}ms`);
  }

  const report = {
    generatedAt: isoTimestamp(),
    apiBase: API_BASE,
    shopId,
    runs: BENCH_RUNS,
    results,
  };

  const baseline = readJsonReport('backend-api-report.baseline.json');
  const mdPath = writeMarkdownReport('backend-api-report.md', renderBackendMarkdown(report, baseline));
  const jsonPath = writeJsonReport('backend-api-report.json', report);

  const failed = results.filter((r) => r.status === 'fail');
  const errors = results.filter((r) => r.status === 'error');

  console.log(`\nReport written:\n  ${mdPath}\n  ${jsonPath}`);
  console.log(`\nSummary: ${results.length} endpoints, ${failed.length} slow, ${errors.length} errors`);
  if (failed.length) {
    console.log('\nSlowest (p95):');
    for (const r of [...failed].sort((a, b) => b.p95 - a.p95).slice(0, 10)) {
      console.log(`  ${r.p95}ms  ${r.name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
