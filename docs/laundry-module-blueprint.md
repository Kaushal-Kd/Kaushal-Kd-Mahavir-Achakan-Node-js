# Laundry Module Blueprint

## Purpose
Provide a full-stack implementation path for Laundry Job persistence and report integration used by Desktop `CreateLaundryJob` page.

## Proposed Backend Files

- `apps/backend/src/modules/laundry/routes.js`
- `apps/backend/src/modules/laundry/service.js`
- `apps/backend/src/modules/laundry/schema.js`

Register in `apps/backend/src/server.js`:

- `fastify.register(import('./modules/laundry/routes.js'), { prefix: '/api/laundry' })`

## Proposed Database Tables

### 1) `laundry_jobs`

- `id` (uuid, pk)
- `shop_id` (uuid, indexed)
- `job_no` (varchar(40), unique per shop)
- `laundry_date` (date)
- `vendor_account_id` (varchar(80), fk-ish to `payment_accounts.id`)
- `pickup_by` (varchar(120), nullable)
- `remarks` (text, nullable)
- `product_total` (decimal(12,2), default 0)
- `accessory_total` (decimal(12,2), default 0)
- `subtotal` (decimal(12,2), default 0)
- `discount_mode` (enum: `fixed`, `percent`)
- `discount_value` (decimal(12,2), default 0)
- `discount_amount` (decimal(12,2), default 0)
- `payable_amount` (decimal(12,2), default 0)
- `status` (enum: `sent`, `in_process`, `ready`, `received_partial`, `received_full`)
- `is_deleted` (tinyint(1), default 0)
- `deleted_at` (timestamp nullable)
- `created_at`, `updated_at` (timestamp)

### 2) `laundry_job_products`

- `id` (uuid, pk)
- `laundry_job_id` (uuid, indexed)
- `shop_id` (uuid, indexed)
- `product_id` (uuid, nullable for snapshot safety)
- `product_code` (varchar(80))
- `product_name` (varchar(200))
- `size` (varchar(80), nullable)
- `color` (varchar(80), nullable)
- `qty` (int)
- `rate` (decimal(12,2))
- `line_total` (decimal(12,2))
- `priority` (enum: `urgent`, `high`, `medium`, `low`, `no_schedule`)
- `next_pickup_date` (date, nullable)
- `days_left` (int, nullable)
- `scan_status` (enum: `manual`, `scanned`)
- `created_at`, `updated_at` (timestamp)

### 3) `laundry_job_accessories`

- `id` (uuid, pk)
- `laundry_job_id` (uuid, indexed)
- `shop_id` (uuid, indexed)
- `accessory_id` (uuid, nullable)
- `accessory_code` (varchar(80))
- `accessory_name` (varchar(200))
- `qty` (int)
- `rate` (decimal(12,2))
- `line_total` (decimal(12,2))
- `scan_status` (enum: `manual`, `scanned`)
- `created_at`, `updated_at` (timestamp)

### 4) `laundry_job_logs` (optional, recommended)

- `id` (uuid, pk)
- `laundry_job_id` (uuid, indexed)
- `shop_id` (uuid, indexed)
- `user_id` (uuid, nullable)
- `action` (varchar(60))
- `old_value` (json, nullable)
- `new_value` (json, nullable)
- `created_at` (timestamp)

## Service Behaviors

### Create Job

1. Validate vendor account under same `shop_id`, active, and group `Vendors` or `Laundry Vendor`.
2. Validate stock for product/accessory qty.
3. Calculate totals server-side.
4. Insert header + lines in one transaction.
5. Set inventory/ops status to out-for-laundry:
   - product status to `washing` or dedicated laundry state.
6. Create vendor payable ledger event.
7. Create audit log rows.

### Update Status

Allow transitions:

- `sent -> in_process -> ready -> received_partial -> received_full`
- Update inventory state back when rows received.

## API Endpoints

- `GET /api/laundry` list jobs
- `GET /api/laundry/:id` job details
- `POST /api/laundry` create job
- `PUT /api/laundry/:id` update editable header/rows while in `sent`/`in_process`
- `POST /api/laundry/:id/status` status transition
- `POST /api/laundry/:id/receive` receive full/partial lines

## Reports Integration

Extend reports module to include:

- Laundry Pending Report
- Urgent Pickup Laundry Risk Report
- Vendor Laundry Ledger
- Inventory Laundry Status
- Product Laundry History trail

Suggested route prefix:

- `GET /api/reports/laundry/pending`
- `GET /api/reports/laundry/risk`
- `GET /api/reports/laundry/vendor-ledger`
- `GET /api/reports/laundry/inventory-status`
- `GET /api/reports/laundry/product-history`

## Permissions

Use shared constants in `@wrs/shared/constants/permissions`:

- `MODULES.LAUNDRY`
- actions `view`, `create`, `update`, `delete`, `export`

Enforce in routes with `fastify.requirePermission(...)`.

