# Frontend Page-Load Performance Report

Generated: 2026-06-20T05:09:43.127Z
API base: http://127.0.0.1:4000
Shop: 4eb2642b-53b2-4f7d-b7a1-21031902d4d3

Simulates the HTTP calls each page fires on mount (parallel fetch).

## Summary

| Metric | Value |
|--------|-------|
| Pages simulated | 9 |
| Total unique API paths | 23 |
| Duplicate path hits (simulated) | 11 |

## Per-page load

| Page | Requests | Wall time | Total KB | Slowest call |
|------|----------|-----------|----------|--------------|
| Global shell (every route) | 2 | 61ms | 5 | /api/configurations/app-settings (59ms) |
| Dashboard | 9 | 148ms | 7 | /api/dashboard (148ms) |
| CreateOrder (create mode) | 5 | 127ms | 18 | /api/users?per_page=200 (126ms) |
| BookingList | 1 | 51ms | 0 | /api/orders?per_page=25&lean=1&with_next_booking_alerts=1&sort=-created_at (51ms) |
| DeliveryList | 2 | 72ms | 3 | /api/configurations/app-settings (72ms) |
| ReturnList | 2 | 65ms | 3 | /api/configurations/app-settings (63ms) |
| ItemToCollectList | 4 | 140ms | 9 | /api/users?per_page=200 (139ms) |
| ItemToPrepareList | 4 | 231ms | 9 | /api/users?per_page=200 (230ms) |
| ProductList | 5 | 142ms | 23 | /api/products?per_page=25 (141ms) |

## Duplicate API paths (same URL fetched from multiple pages)

| Path | Pages |
|------|-------|
| `/api/configurations/app-settings` | Global shell (every route), Dashboard, CreateOrder (create mode), DeliveryList, ReturnList, ItemToCollectList, ItemToPrepareList |
| `/api/users?per_page=200` | CreateOrder (create mode), ItemToCollectList, ItemToPrepareList |
| `/api/categories?type=product` | ItemToCollectList, ItemToPrepareList, ProductList |
| `/api/drafts?kind=availability_cart` | Global shell (every route), Dashboard |

## Navigation scenario: Dashboard → Booking → Delivery

- Sequential wall time: **271ms**
- Total requests: **12**
- Total payload: **11 KB**

## Per-page request detail

### Global shell (every route)

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/drafts?kind=availability_cart` | 59ms | 2 | 200 |
| `/api/configurations/app-settings` | 59ms | 3 | 200 |

### Dashboard

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/dashboard` | 148ms | 1 | 200 |
| `/api/configurations/app-settings` | 62ms | 3 | 200 |
| `/api/drafts?kind=availability_cart` | 67ms | 2 | 200 |
| `/api/reminders` | 65ms | 0 | 200 |
| `/api/custom-orders/trial-reminders` | 63ms | 0 | 200 |
| `/api/dashboard/revenue-series` | 65ms | 1 | 200 |
| `/api/dashboard/activity?limit=25` | 65ms | 0 | 200 |
| `/api/dashboard/calendar-bookings-trend?months=12` | 103ms | 0 | 200 |
| `/api/dashboard/calendar?month=2026-06` | 145ms | 0 | 200 |

### CreateOrder (create mode)

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/payment-accounts` | 80ms | 0 | 200 |
| `/api/security-accounts` | 80ms | 0 | 200 |
| `/api/time-slots` | 125ms | 10 | 200 |
| `/api/users?per_page=200` | 126ms | 5 | 200 |
| `/api/configurations/app-settings` | 80ms | 3 | 200 |

### BookingList

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/orders?per_page=25&lean=1&with_next_booking_alerts=1&sort=-created_at` | 51ms | 0 | 200 |

### DeliveryList

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/orders?per_page=25&date_field=pickup_date&statuses=in_preparation,ready_for_delivery,delivered&sort=-pickup_date&lean=1` | 71ms | 0 | 200 |
| `/api/configurations/app-settings` | 72ms | 3 | 200 |

### ReturnList

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/orders?per_page=25&date_field=return_date&statuses=delivered,partially_returned&sort=-return_date&lean=1` | 63ms | 0 | 200 |
| `/api/configurations/app-settings` | 63ms | 3 | 200 |

### ItemToCollectList

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/orders/items-to-collect?lines=1&per_page=20&skip_enrich=1&pickup_from=2026-06-20&pickup_to=2026-06-20` | 59ms | 0 | 200 |
| `/api/categories?type=product` | 138ms | 1 | 200 |
| `/api/users?per_page=200` | 139ms | 5 | 200 |
| `/api/configurations/app-settings` | 60ms | 3 | 200 |

### ItemToPrepareList

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/orders/items-to-prepare?lines=1&per_page=20&skip_enrich=1&pickup_from=2026-06-20&pickup_to=2026-06-20` | 67ms | 0 | 200 |
| `/api/categories?type=product` | 230ms | 1 | 200 |
| `/api/users?per_page=200` | 230ms | 5 | 200 |
| `/api/configurations/app-settings` | 67ms | 3 | 200 |

### ProductList

| API | Duration | KB | Status |
|-----|----------|----|--------|
| `/api/products?per_page=25` | 141ms | 20 | 200 |
| `/api/configurations/colors` | 52ms | 1 | 200 |
| `/api/configurations/sizes` | 51ms | 0 | 200 |
| `/api/products/category-counts` | 73ms | 0 | 200 |
| `/api/categories?type=product` | 105ms | 1 | 200 |


## Page wall-time comparison (before → after)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| ProductList | 259ms (5 reqs) | 142ms (5 reqs) | -117ms |
| Dashboard | 222ms (9 reqs) | 148ms (9 reqs) | -74ms |
| BookingList | 99ms (1 reqs) | 51ms (1 reqs) | -48ms |
| CreateOrder (create mode) | 138ms (5 reqs) | 127ms (5 reqs) | -11ms |
| ReturnList | 72ms (2 reqs) | 65ms (2 reqs) | -7ms |
| Global shell (every route) | 56ms (2 reqs) | 61ms (2 reqs) | +5ms |
| DeliveryList | 64ms (2 reqs) | 72ms (2 reqs) | +8ms |
| ItemToCollectList | 132ms (4 reqs) | 140ms (4 reqs) | +8ms |
| ItemToPrepareList | 120ms (4 reqs) | 231ms (4 reqs) | +111ms |