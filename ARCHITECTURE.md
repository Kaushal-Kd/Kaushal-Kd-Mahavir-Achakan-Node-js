# Architecture

This document explains **how** Achakan is assembled and
**why** each boundary exists. It is the primary reference for adding new
modules so everything stays consistent.

---

## 1. Topology

```
+------------------+        +-----------------------+
|  apps/desktop    |  HTTP  |     apps/backend      |
|  (Electron +     +------->+  Fastify + Knex        |
|   React + Vite)  |        |  MySQL (cloud)         |
+------------------+        +-----------------------+
        ^                              ^
        | SQLite (local, offline-first)|
        |                              |
+-------+----------+                   |
| packages/shared  |<------------------+
|  Zod schemas     |    (same schemas run on both sides)
|  enums, utils    |
+------------------+

+------------------+
|  apps/mobile     |  (Phase 2 \u2014 same backend, same shared package)
|  React Native    |
+------------------+
```

- **`apps/backend`** is the single source of truth for persistence,
  business rules and auth. It is stateless behind the load balancer.
- **`apps/desktop`** is a thin-ish client: it renders the UI and keeps
  a local SQLite cache for offline use. It does **not** own business
  rules — those live in the backend and are mirrored through
  `@wrs/shared` Zod schemas.
- **`packages/shared`** is consumed by every app. It contains:
  - enums (roles, permissions, order status, event types, categories),
  - Zod schemas (used for both frontend form validation _and_ backend
    request validation \u2014 never duplicated),
  - pure utilities (currency, date, bill-number helpers).

---

## 2. Non-negotiable rules

1. **JSX only.** No TypeScript. A pre-commit hook (`scripts/check-no-typescript.js`) fails the build on any `.ts`, `.tsx`, or `tsconfig*.json` anywhere in the repo.
2. **Strict theme.** White (`#FFFFFF`) + brand blue (`#0C6EE1`). No gradients. Tailwind is configured to only expose the approved palette and to disable gradient utilities.
3. **Zod for all runtime types.** Both sides of the wire validate with the _same_ schema object imported from `@wrs/shared`.
4. **PropTypes for UI components.** Every component with props must declare `propTypes` and, where appropriate, `defaultProps`.
5. **Audit everything.** Mutations on the backend log to `audit_logs` via the `request.audit(entity, action, payload)` helper.
6. **Soft delete, never hard.** Tables have `is_deleted` / `deleted_at` columns and list queries filter them out by default.

---

## 3. Backend layering

```
src/
  config/       # env vars loaded once, validated by Zod
  db/
    knex.js     # the pool
    migrations/ # every table + constraint lives here
    seed.js     # super-admin + default shop + default categories
  plugins/
    auth.js     # JWT, request.authenticate, request.requireShop
    audit.js    # request.audit() helper
    errorHandler.js
  modules/
    <feature>/
      routes.js   # Fastify route definitions \u2014 THIN
      service.js  # business rules, Knex queries, transactions
      schema.js   # (optional) feature-specific schemas
  utils/
    errors.js     # AppError classes used app-wide
    validate.js   # tiny wrapper around Zod that throws AppError
    pagination.js # consistent ?page / ?per_page / ?search / ?sort
    password.js   # bcrypt wrappers
  server.js       # composition root
```

**Route handler contract** (enforced by convention, not a framework):

```js
fastify.post('/', async (request) => {
  const body = validate(createThingSchema, { ...request.body, shop_id: request.shopId });
  const data = await service.create(request.shopId, body, request.authUser.id);
  await request.audit('things', 'CREATE', { id: data.id, new: data });
  return { ok: true, data };
});
```

- Validation happens once, at the edge, with a schema from `@wrs/shared`.
- `service.*` never touches `request` / `reply`.
- Every mutation emits an audit entry before returning.

---

## 4. Desktop layering

```
src/
  lib/
    api.js                # Axios instance + JWT + shop-id + refresh
    api/<feature>.js      # thin per-module wrapper around axios
    queryClient.js        # TanStack Query default options
  stores/
    authStore.js          # session (Zustand persist)
    shopStore.js          # selected shop + list of accessible shops
    uiStore.js            # toasts, search modal, sync status
  services/
    syncService.js        # online/offline + outbound queue (Phase 2)
    imageCache.js         # per-shop LRU image cache (Phase 2)
    gcsUpload.js          # client side of signed-URL upload
  components/
    ui/*                  # Tailwind kit (Button, Input, DataTable, \u2026)
    layout/*              # Sidebar, TopBar, Layout
    ErrorBoundary.jsx
    GlobalSearchModal.jsx
    OfflineBanner.jsx
  hooks/
    useKeyboardShortcuts.js
    useIdleLogout.js
  pages/
    <feature>/
      <Feature>List.jsx       # table + pagination
      <Feature>FormModal.jsx  # create / edit in a modal
      <Feature>Detail.jsx     # (when needed) full page view
  App.jsx                # HashRouter + protected routes
  main.jsx               # ReactDOM.createRoot entry
  styles/index.css       # Tailwind + custom components
electron/
  main.cjs               # window, IPC, single-instance lock
  preload.cjs            # exposed API surface
```

**Page handler contract** (see Customers + Products for the reference
implementation):

1. **Fetch** — TanStack Query hook using `queryKey: ['feature', params]` and `queryFn: () => featureApi.list(params)`.
2. **Mutate** — TanStack Query `useMutation` with on-success `queryClient.invalidateQueries` and a toast.
3. **Validate** — Zod schema from `@wrs/shared` populates field errors via `error.details`.

---

## 5. Multi-shop context

- The selected shop is in `useShopStore()` and persists in localStorage.
- The Axios interceptor attaches `x-shop-id: <uuid>` to **every** request.
- Backend `fastify.requireShop` validates that the user has access to that shop (stored in `user_shops`) and sets `request.shopId`.
- Every shop-scoped table has `shop_id` + index; service queries always filter by it.
- Switching shops in the `ShopSelector` invalidates _all_ queries so
  data never leaks across shops.

---

## 6. Offline-first (Phase 2 \u2014 scaffolded in Phase 1)

- `services/syncService.js` exposes the stable API (`subscribe`,
  `sync`, `enqueue`) that the UI already consumes (`SyncIndicator`,
  `OfflineBanner`).
- Phase 2 will swap the stub implementation for PowerSync (or our own
  delta-log sync over `/sync/push` + `/sync/pull`) without touching
  the UI.

---

## 7. Images (GCS)

- Uploads are **never** proxied through the API server. Client requests
  a signed URL (`POST /uploads/signed-url`), PUTs directly to GCS, and
  stores the returned object path on the entity.
- Reads use either the public URL or a short-lived signed URL served
  by the API for private buckets.
- `SmartImage` falls back to a skeleton then a placeholder glyph when
  the image fails, so the UI never shows a broken image.

---

## 8. Where to add a new module

See `MODULE-PATTERN.md` \u2014 it is a 1-page checklist.
