/**
 * Shared helpers for performance audit scripts (benchmark-apis, audit-frontend-pages).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const PERF_DIR = path.join(REPO_ROOT, 'docs', 'perf');

export const API_BASE = (process.env.API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');
export const BENCH_EMAIL = process.env.BENCH_EMAIL || '';
export const BENCH_PASSWORD = process.env.BENCH_PASSWORD || '';
export let BENCH_SHOP_ID = process.env.BENCH_SHOP_ID || '';
export const BENCH_ORDER_ID = process.env.BENCH_ORDER_ID || '';
export const BENCH_PRODUCT_ID = process.env.BENCH_PRODUCT_ID || '';
export const BENCH_CUSTOMER_ID = process.env.BENCH_CUSTOMER_ID || '';
export const BENCH_RUNS = Math.max(1, Number(process.env.BENCH_RUNS || 5));

export const GET_P95_MS = Number(process.env.PERF_GET_P95_MS || 2000);
export const WRITE_P95_MS = Number(process.env.PERF_WRITE_P95_MS || 3000);

export function setShopId(id) {
  BENCH_SHOP_ID = String(id || '');
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function summarizeSamples(samples) {
  if (!samples.length) {
    return { p50: 0, p95: 0, max: 0, ok: 0, total: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    max: Math.round(sorted[sorted.length - 1]),
    ok: samples.length,
    total: samples.length,
  };
}

export function passThreshold(method, p95) {
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || 'GET').toUpperCase());
  const limit = isWrite ? WRITE_P95_MS : GET_P95_MS;
  return p95 <= limit ? 'pass' : 'fail';
}

export function ensurePerfDir() {
  fs.mkdirSync(PERF_DIR, { recursive: true });
}

export function isoTimestamp() {
  return new Date().toISOString();
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function monthIso(offsetMonths = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
}

export async function request(path, { method = 'GET', token, body, shopId } = {}) {
  const headers = { Accept: 'application/json' };
  const sid = shopId || BENCH_SHOP_ID;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sid) headers['x-shop-id'] = sid;
  if (body) headers['Content-Type'] = 'application/json';

  const start = performance.now();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const durationMs = performance.now() - start;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  const payloadBytes = Buffer.byteLength(text || '', 'utf8');
  const rowCount = extractRowCount(json);
  return {
    ok: res.ok,
    status: res.status,
    durationMs,
    json,
    payloadBytes,
    rowCount,
  };
}

function extractRowCount(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.data)) return json.data.length;
  if (json.meta?.total != null) return Number(json.meta.total);
  if (json.data?.data && Array.isArray(json.data.data)) return json.data.data.length;
  return null;
}

export async function login() {
  if (!BENCH_EMAIL || !BENCH_PASSWORD) {
    throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD');
  }
  const res = await request('/api/auth/login', {
    method: 'POST',
    body: { email: BENCH_EMAIL, password: BENCH_PASSWORD },
  });
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.json)}`);
  }
  const token = res.json?.data?.access_token || res.json?.access_token;
  if (!token) throw new Error('Login response missing access_token');
  const shops = res.json?.data?.shops || [];
  const shopId =
    BENCH_SHOP_ID ||
    shops.find((s) => s.is_default)?.id ||
    shops[0]?.id ||
    res.json?.data?.user?.last_selected_shop_id ||
    res.json?.data?.user?.primary_shop_id;
  if (!shopId) throw new Error('Login response missing shop id (set BENCH_SHOP_ID)');
  return { token, shopId: String(shopId) };
}

export async function benchEndpoint(name, meta, fn, runs = BENCH_RUNS) {
  const samples = [];
  let lastError = null;
  let lastMeta = { status: 0, payloadBytes: 0, rowCount: null };

  for (let i = 0; i < runs; i += 1) {
    try {
      const result = await fn();
      samples.push(result.durationMs);
      lastMeta = {
        status: result.status,
        payloadBytes: result.payloadBytes,
        rowCount: result.rowCount,
      };
      if (!result.ok) {
        lastError = new Error(`HTTP ${result.status}`);
        break;
      }
    } catch (err) {
      lastError = err;
      break;
    }
  }

  const summary = summarizeSamples(samples);
  const method = meta?.method || 'GET';
  const status = lastError ? 'error' : passThreshold(method, summary.p95);
  return {
    name,
    group: meta?.group || 'other',
    method,
    path: meta?.path || name,
    risk: meta?.risk || '',
    ...summary,
    status,
    httpStatus: lastMeta.status,
    payloadBytes: lastMeta.payloadBytes,
    rowCount: lastMeta.rowCount,
    error: lastError?.message || null,
  };
}

export function writeJsonReport(filename, data) {
  ensurePerfDir();
  const filePath = path.join(PERF_DIR, filename);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readJsonReport(filename) {
  const filePath = path.join(PERF_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function appendComparisonSection(lines, label, before, after, keyFn) {
  if (!before || !after) return;
  lines.push('', `## ${label} (before → after)`, '');
  lines.push('| Metric | Before | After | Delta |');
  lines.push('|--------|--------|-------|-------|');
  for (const row of keyFn(before, after)) {
    lines.push(`| ${row.name} | ${row.before} | ${row.after} | ${row.delta} |`);
  }
}

export function writeMarkdownReport(filename, content) {
  ensurePerfDir();
  const filePath = path.join(PERF_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export function renderBackendMarkdown(report, baseline = null) {
  const lines = [
    '# Backend API Performance Report',
    '',
    `Generated: ${report.generatedAt}`,
    `API base: ${report.apiBase}`,
    `Shop: ${report.shopId}`,
    `Runs per endpoint: ${report.runs}`,
    '',
    `Thresholds: GET p95 ≤ ${GET_P95_MS}ms, writes p95 ≤ ${WRITE_P95_MS}ms`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Endpoints tested | ${report.results.length} |`,
    `| Passed | ${report.results.filter((r) => r.status === 'pass').length} |`,
    `| Failed (slow) | ${report.results.filter((r) => r.status === 'fail').length} |`,
    `| Errors | ${report.results.filter((r) => r.status === 'error').length} |`,
    '',
    '## Slowest endpoints (p95)',
    '',
    '| Endpoint | Group | p50 | p95 | max | KB | Rows | Status |',
    '|----------|-------|-----|-----|-----|----|------|--------|',
  ];

  const sorted = [...report.results].sort((a, b) => b.p95 - a.p95);
  for (const r of sorted.slice(0, 25)) {
    const kb = r.payloadBytes ? `${Math.round(r.payloadBytes / 1024)}` : '—';
    const rows = r.rowCount != null ? String(r.rowCount) : '—';
    lines.push(
      `| \`${r.name}\` | ${r.group} | ${r.p50}ms | ${r.p95}ms | ${r.max}ms | ${kb} | ${rows} | ${r.status} |`
    );
  }

  lines.push('', '## All endpoints by group', '');

  const byGroup = new Map();
  for (const r of report.results) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }

  for (const [group, rows] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${group}`, '');
    lines.push('| Endpoint | p50 | p95 | max | Status | Notes |');
    lines.push('|----------|-----|-----|-----|--------|-------|');
    for (const r of rows.sort((a, b) => b.p95 - a.p95)) {
      lines.push(
        `| \`${r.name}\` | ${r.p50}ms | ${r.p95}ms | ${r.max}ms | ${r.status} | ${r.risk || r.error || ''} |`
      );
    }
    lines.push('');
  }

  appendComparisonSection(lines, 'Endpoint p95 comparison', baseline, report, () => {
    const beforeMap = new Map((baseline.results || []).map((r) => [r.name, r]));
    return report.results
      .filter((r) => beforeMap.has(r.name))
      .map((r) => {
        const prev = beforeMap.get(r.name);
        const delta = r.p95 - prev.p95;
        const sign = delta > 0 ? '+' : '';
        return {
          name: r.name,
          before: `${prev.p95}ms`,
          after: `${r.p95}ms`,
          delta: `${sign}${delta}ms`,
        };
      })
      .sort((a, b) => {
        const da = Number(String(a.delta).replace('ms', '').replace('+', ''));
        const db = Number(String(b.delta).replace('ms', '').replace('+', ''));
        return da - db;
      })
      .slice(0, 20);
  });

  return lines.join('\n');
}

export function renderFrontendMarkdown(report, baseline = null) {
  const lines = [
    '# Frontend Page-Load Performance Report',
    '',
    `Generated: ${report.generatedAt}`,
    `API base: ${report.apiBase}`,
    `Shop: ${report.shopId}`,
    '',
    'Simulates the HTTP calls each page fires on mount (parallel fetch).',
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Pages simulated | ${report.pages.length} |`,
    `| Total unique API paths | ${report.uniquePaths} |`,
    `| Duplicate path hits (simulated) | ${report.duplicateHits} |`,
    '',
    '## Per-page load',
    '',
    '| Page | Requests | Wall time | Total KB | Slowest call |',
    '|------|----------|-----------|----------|--------------|',
  ];

  for (const p of report.pages) {
    lines.push(
      `| ${p.name} | ${p.requestCount} | ${p.wallMs}ms | ${Math.round(p.totalBytes / 1024)} | ${p.slowest?.name || '—'} (${p.slowest?.ms || 0}ms) |`
    );
  }

  lines.push('', '## Duplicate API paths (same URL fetched from multiple pages)', '');
  if (!report.duplicates.length) {
    lines.push('_None detected in this simulation._');
  } else {
    lines.push('| Path | Pages |');
    lines.push('|------|-------|');
    for (const d of report.duplicates) {
      lines.push(`| \`${d.path}\` | ${d.pages.join(', ')} |`);
    }
  }

  lines.push('', '## Navigation scenario: Dashboard → Booking → Delivery', '');
  if (report.navigationScenario) {
    lines.push(`- Sequential wall time: **${report.navigationScenario.wallMs}ms**`);
    lines.push(`- Total requests: **${report.navigationScenario.requestCount}**`);
    lines.push(`- Total payload: **${Math.round(report.navigationScenario.totalBytes / 1024)} KB**`);
  }

  lines.push('', '## Per-page request detail', '');
  for (const p of report.pages) {
    lines.push(`### ${p.name}`, '');
    lines.push('| API | Duration | KB | Status |');
    lines.push('|-----|----------|----|--------|');
    for (const r of p.requests) {
      lines.push(
        `| \`${r.path}\` | ${Math.round(r.durationMs)}ms | ${Math.round(r.payloadBytes / 1024)} | ${r.status} |`
      );
    }
    lines.push('');
  }

  appendComparisonSection(lines, 'Page wall-time comparison', baseline, report, () => {
    const beforeMap = new Map((baseline.pages || []).map((p) => [p.name, p]));
    return report.pages
      .filter((p) => beforeMap.has(p.name))
      .map((p) => {
        const prev = beforeMap.get(p.name);
        const delta = p.wallMs - prev.wallMs;
        const sign = delta > 0 ? '+' : '';
        return {
          name: p.name,
          before: `${prev.wallMs}ms (${prev.requestCount} reqs)`,
          after: `${p.wallMs}ms (${p.requestCount} reqs)`,
          delta: `${sign}${delta}ms`,
        };
      })
      .sort((a, b) => {
        const da = Number(String(a.delta).replace('ms', '').replace('+', ''));
        const db = Number(String(b.delta).replace('ms', '').replace('+', ''));
        return da - db;
      })
      .slice(0, 15);
  });

  return lines.join('\n');
}
