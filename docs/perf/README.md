# Performance audit reports

Automated backend API benchmarks and frontend page-load simulations for Achakan.

## Prerequisites

1. Backend running locally (or set `API_BASE` to your server).
2. Valid login credentials and shop id.

```bash
npm run dev:backend
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_BASE` | No | `http://127.0.0.1:4000` | Backend URL |
| `BENCH_EMAIL` | Yes | — | Login email |
| `BENCH_PASSWORD` | Yes | — | Login password |
| `BENCH_SHOP_ID` | No | from login | Shop UUID |
| `BENCH_ORDER_ID` | No | — | Order UUID for detail benchmarks |
| `BENCH_PRODUCT_ID` | No | — | Product UUID for detail benchmarks |
| `BENCH_RUNS` | No | `5` | Samples per endpoint |
| `PERF_GET_P95_MS` | No | `2000` | GET pass threshold (ms) |
| `PERF_WRITE_P95_MS` | No | `3000` | Write pass threshold (ms) |

Optional backend logging during manual testing:

```bash
PERF_LOG_ALL=1 npm run dev:backend
```

Logs every request duration (not just slow requests ≥ 500ms).

## Run reports

```bash
# Backend API benchmark only
npm run benchmark:api

# Frontend page-load simulation only
npm run audit:frontend

# Both (recommended)
npm run audit:perf
```

Example with credentials:

```bash
API_BASE=http://127.0.0.1:4000 \
BENCH_EMAIL=admin@wrs.local \
BENCH_PASSWORD=Admin@12345 \
BENCH_SHOP_ID=<shop-uuid> \
BENCH_ORDER_ID=<order-uuid> \
npm run audit:perf
```

## Output files

| File | Description |
|------|-------------|
| `docs/perf/backend-api-report.md` | Backend p50/p95/max per endpoint |
| `docs/perf/backend-api-report.json` | Machine-readable backend results |
| `docs/perf/frontend-page-report.md` | Simulated page mount load |
| `docs/perf/frontend-page-report.json` | Machine-readable frontend results |
| `docs/perf/*.baseline.json` | Snapshot for before/after comparison |

## Before/after comparison

After an initial run, snapshot baselines and re-run to append comparison tables to the Markdown reports:

```bash
PERF_REBENCHMARK=1 npm run audit:perf
```

This copies the current JSON reports to `*.baseline.json`, re-runs the audit, and adds delta tables to the `.md` files.

## Thresholds

- **GET** endpoints: p95 < 2000ms
- **Writes** (POST/PUT/PATCH/DELETE): p95 < 3000ms

Targets assume co-located MySQL. Remote DB or large datasets may need higher thresholds.

## Re-run after optimizations

After code changes, run `npm run audit:perf` again and compare JSON reports or the slowest-endpoints table in the Markdown files.
