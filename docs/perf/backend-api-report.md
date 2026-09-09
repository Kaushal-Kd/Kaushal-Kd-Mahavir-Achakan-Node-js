# Backend API Performance Report

Generated: 2026-06-20T05:09:41.115Z
API base: http://127.0.0.1:4000
Shop: 4eb2642b-53b2-4f7d-b7a1-21031902d4d3
Runs per endpoint: 3

Thresholds: GET p95 ≤ 2000ms, writes p95 ≤ 3000ms

## Summary

| Metric | Value |
|--------|-------|
| Endpoints tested | 59 |
| Passed | 56 |
| Failed (slow) | 0 |
| Errors | 3 |

## Slowest endpoints (p95)

| Endpoint | Group | p50 | p95 | max | KB | Rows | Status |
|----------|-------|-----|-----|-----|----|------|--------|
| `GET /api/products/inventory` | products | 254ms | 297ms | 297ms | 16 | 25 | pass |
| `GET /api/users` | bootstrap | 135ms | 272ms | 272ms | 5 | 1 | pass |
| `GET /api/products` | products | 156ms | 270ms | 270ms | 20 | 25 | pass |
| `GET /api/time-slots` | bootstrap | 259ms | 262ms | 262ms | 10 | 34 | pass |
| `GET /api/reports/product-performance` | reports | 205ms | 250ms | 250ms | 9 | — | pass |
| `GET /api/dashboard` | dashboard | 167ms | 243ms | 243ms | 1 | — | pass |
| `GET /api/categories?type=product` | bootstrap | 176ms | 221ms | 221ms | 1 | 4 | pass |
| `GET /api/reports/pending-bills` | reports | 128ms | 209ms | 209ms | 0 | — | pass |
| `GET /api/whatsapp/connection` | lists | 165ms | 209ms | 209ms | 0 | — | pass |
| `GET /api/drafts?kind=availability_cart` | bootstrap | 160ms | 198ms | 198ms | 2 | 2 | pass |
| `GET /api/reports/income-expense` | reports | 147ms | 188ms | 188ms | 0 | — | pass |
| `GET /api/dashboard/revenue-series` | dashboard | 67ms | 172ms | 172ms | 1 | 30 | pass |
| `GET /api/customers` | lists | 133ms | 169ms | 169ms | 1 | 2 | pass |
| `GET /api/security-charges` | ops | 151ms | 158ms | 158ms | 0 | 0 | pass |
| `GET /api/dashboard/calendar` | dashboard | 133ms | 145ms | 145ms | 0 | — | pass |
| `GET /api/reports/daily-cashbook` | reports | 117ms | 142ms | 142ms | 0 | — | pass |
| `GET /api/dashboard/calendar-bookings-trend` | dashboard | 135ms | 135ms | 135ms | 0 | 12 | pass |
| `GET /api/reports/inventory` | reports | 104ms | 123ms | 123ms | 0 | — | pass |
| `GET /api/categories?type=accessory` | bootstrap | 80ms | 122ms | 122ms | 0 | 0 | pass |
| `GET /api/products (lean)` | products | 102ms | 114ms | 114ms | 16 | 25 | pass |
| `GET /api/security-accounts` | bootstrap | 92ms | 113ms | 113ms | 0 | 0 | pass |
| `GET /api/products/availability-list` | products | 106ms | 111ms | 111ms | 9 | 25 | pass |
| `GET /api/products/booking-availability` | products | 104ms | 110ms | 110ms | 11 | 20 | pass |
| `GET /api/laundry` | ops | 80ms | 109ms | 109ms | 0 | 0 | pass |
| `GET /api/reminders` | lists | 81ms | 108ms | 108ms | 0 | 0 | pass |

## All endpoints by group

### bootstrap

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/users` | 135ms | 272ms | 272ms | pass | Salesman dropdowns |
| `GET /api/time-slots` | 259ms | 262ms | 262ms | pass | Booking form |
| `GET /api/categories?type=product` | 176ms | 221ms | 221ms | pass | Shared across lists |
| `GET /api/drafts?kind=availability_cart` | 160ms | 198ms | 198ms | pass | TopBar + Dashboard |
| `GET /api/categories?type=accessory` | 80ms | 122ms | 122ms | pass | Accessory lists |
| `GET /api/security-accounts` | 92ms | 113ms | 113ms | pass | Booking form |
| `GET /api/configurations/colors` | 64ms | 73ms | 73ms | pass | Product forms/lists |
| `GET /api/configurations/sizes` | 63ms | 71ms | 71ms | pass | Product forms/lists |
| `GET /api/payment-accounts` | 67ms | 68ms | 68ms | pass | Booking/sales forms |
| `GET /api/configurations/app-settings` | 57ms | 64ms | 64ms | pass | Fetched on most pages |

### dashboard

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/dashboard` | 167ms | 243ms | 243ms | pass | 11 parallel DB aggregations |
| `GET /api/dashboard/revenue-series` | 67ms | 172ms | 172ms | pass | Revenue chart |
| `GET /api/dashboard/calendar` | 133ms | 145ms | 145ms | pass | Calendar day view (one month) |
| `GET /api/dashboard/calendar-bookings-trend` | 135ms | 135ms | 135ms | pass | Single query for 12-month booking chart |
| `GET /api/dashboard/activity` | 87ms | 90ms | 90ms | pass | Activity feed |

### lists

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/whatsapp/connection` | 165ms | 209ms | 209ms | pass | Global WhatsApp provider |
| `GET /api/customers` | 133ms | 169ms | 169ms | pass | Customer list |
| `GET /api/reminders` | 81ms | 108ms | 108ms | pass | Dashboard reminders |
| `GET /api/income-entries` | 68ms | 98ms | 98ms | pass | Income list |
| `GET /api/accessories` | 60ms | 90ms | 90ms | pass | Accessory list |
| `GET /api/custom-orders` | 72ms | 89ms | 89ms | pass | Custom orders |
| `GET /api/system-logs` | 62ms | 84ms | 84ms | pass | Audit logs |
| `GET /api/payment-vouchers` | 64ms | 78ms | 78ms | pass | Payment vouchers |
| `GET /api/custom-orders/trial-reminders` | 62ms | 67ms | 67ms | pass | Dashboard card |
| `GET /api/receipt-vouchers` | 66ms | 67ms | 67ms | pass | Receipt vouchers |
| `GET /api/expense-entries` | 62ms | 66ms | 66ms | pass | Expense list |
| `GET /api/configurations/whatsapp-messages` | 57ms | 66ms | 66ms | pass | Global WhatsApp provider |
| `GET /api/journal-vouchers` | 59ms | 61ms | 61ms | pass | Journal vouchers |
| `GET /api/credit-notes` | 61ms | 61ms | 61ms | pass | Credit notes |

### ops

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/security-charges` | 151ms | 158ms | 158ms | pass | Security charges |
| `GET /api/laundry` | 80ms | 109ms | 109ms | pass | Laundry jobs list |
| `GET /api/purchases` | 52ms | 98ms | 98ms | pass | Purchases list |
| `GET /api/payments/security-transactions` | 81ms | 89ms | 89ms | pass | Security transactions |
| `GET /api/sales` | 70ms | 75ms | 75ms | pass | Sales list |
| `GET /api/washing-queue` | 69ms | 74ms | 74ms | pass | Unpaginated full queue |
| `GET /api/payments/security-due` | 57ms | 67ms | 67ms | pass | Correlated charge subquery per row |

### orders

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/orders (lean)` | 73ms | 102ms | 102ms | pass | Booking list optimized |
| `GET /api/orders/items-to-collect?lines=1&skip_enrich` | 85ms | 101ms | 101ms | pass | Table view without enrichment |
| `GET /api/orders/items-to-prepare?lines=1` | 63ms | 76ms | 76ms | pass | Same enrichment stack as collect |
| `GET /api/orders (delivery)` | 71ms | 74ms | 74ms | pass | Delivery list without lean |
| `GET /api/orders/items-to-collect?lines=1` | 73ms | 74ms | 74ms | pass | JSON_EXTRACT stage_flags + enrichment |
| `GET /api/orders/booked-products` | 62ms | 72ms | 72ms | pass | Booked products list |
| `GET /api/orders (full)` | 62ms | 64ms | 64ms | pass | Correlated subqueries per row |

### products

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/products/inventory` | 254ms | 297ms | 297ms | pass | Inventory snapshot — filters in Node |
| `GET /api/products` | 156ms | 270ms | 270ms | pass | 4 inventory subqueries per row |
| `GET /api/products (lean)` | 102ms | 114ms | 114ms | pass | Light list without inventory joins |
| `GET /api/products/availability-list` | 106ms | 111ms | 111ms | pass | Availability grid |
| `GET /api/products/booking-availability` | 104ms | 110ms | 110ms | pass | CreateOrder product search |
| `GET /api/products/category-counts` | 104ms | 107ms | 107ms | pass | Product list sidebar |
| `GET /api/products/pending-washing` | 65ms | 94ms | 94ms | pass | Washing queue products |
| `GET /api/products/code-format` | 54ms | 83ms | 83ms | pass | Config lookup |

### reports

| Endpoint | p50 | p95 | max | Status | Notes |
|----------|-----|-----|-----|--------|-------|
| `GET /api/reports/product-performance` | 205ms | 250ms | 250ms | pass | Product performance |
| `GET /api/reports/pending-bills` | 128ms | 209ms | 209ms | pass | Pending bills |
| `GET /api/reports/income-expense` | 147ms | 188ms | 188ms | pass | 18 parallel DB calls |
| `GET /api/reports/daily-cashbook` | 117ms | 142ms | 142ms | pass | Daily cashbook |
| `GET /api/reports/inventory` | 104ms | 123ms | 123ms | pass | Inventory report |
| `GET /api/reports/account-ledger` | 0ms | 0ms | 0ms | error | Multi-source ledger |
| `GET /api/reports/trial-balance` | 0ms | 0ms | 0ms | error | 13-leg UNION ALL |
| `GET /api/reports/salesman` | 0ms | 0ms | 0ms | error | Salesman report |


## Endpoint p95 comparison (before → after)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| GET /api/dashboard | 480ms | 243ms | -237ms |
| GET /api/products | 406ms | 270ms | -136ms |
| GET /api/sales | 178ms | 75ms | -103ms |
| GET /api/orders/items-to-collect?lines=1 | 132ms | 74ms | -58ms |
| GET /api/receipt-vouchers | 121ms | 67ms | -54ms |
| GET /api/products/inventory | 350ms | 297ms | -53ms |
| GET /api/payments/security-due | 120ms | 67ms | -53ms |
| GET /api/washing-queue | 124ms | 74ms | -50ms |
| GET /api/payments/security-transactions | 138ms | 89ms | -49ms |
| GET /api/orders (full) | 102ms | 64ms | -38ms |
| GET /api/custom-orders/trial-reminders | 102ms | 67ms | -35ms |
| GET /api/configurations/sizes | 104ms | 71ms | -33ms |
| GET /api/custom-orders | 118ms | 89ms | -29ms |
| GET /api/configurations/whatsapp-messages | 86ms | 66ms | -20ms |
| GET /api/orders (delivery) | 93ms | 74ms | -19ms |
| GET /api/purchases | 117ms | 98ms | -19ms |
| GET /api/system-logs | 98ms | 84ms | -14ms |
| GET /api/credit-notes | 73ms | 61ms | -12ms |
| GET /api/journal-vouchers | 70ms | 61ms | -9ms |
| GET /api/configurations/app-settings | 72ms | 64ms | -8ms |