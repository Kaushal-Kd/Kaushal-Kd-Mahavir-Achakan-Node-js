# Adding a new module \u2014 checklist

Follow these steps in order. Copy-paste from `customers` / `products`
whenever you get stuck \u2014 they are the canonical reference.

---

## 1. Shared package (`packages/shared`)

If the module introduces a new entity:

- [ ] Add constants (enums, defaults) in `src/constants/<feature>.js` and re-export from `constants/index.js`.
- [ ] Add a Zod schema in `src/schemas/<feature>.js`:
  - `xxxSchema` \u2014 full entity.
  - `createXxxSchema` \u2014 `.omit({ id: true })`.
  - `updateXxxSchema` \u2014 `.partial().extend({ id: ... })`.
- [ ] Re-export from `schemas/index.js`.
- [ ] Add any pure helpers to `src/utils/`.

---

## 2. Backend (`apps/backend`)

- [ ] **Migration** in `src/db/migrations/<timestamp>_<feature>.js` with:
  - `shop_id` FK + index (if shop-scoped),
  - `is_deleted`, `deleted_at`,
  - `created_at`, `updated_at`,
  - all business indexes you will query.
- [ ] **Service** in `src/modules/<feature>/service.js`:
  - `list(shopId, query)` \u2014 returns `paginate(qb, { ... })`,
  - `get(shopId, id)` \u2014 throws `notFound()` if missing,
  - `create(shopId, data, userId)`,
  - `update(shopId, id, data, userId)`,
  - `remove(shopId, id, userId)` \u2014 soft delete.
- [ ] **Routes** in `src/modules/<feature>/routes.js`:
  - `fastify.addHook('onRequest', fastify.authenticate)`
  - `fastify.addHook('onRequest', fastify.requireShop)` (if shop-scoped)
  - Every mutation calls `await request.audit('<table>', '<ACTION>', { id, new, old? })`.
- [ ] Register the routes in `src/server.js`:
  ```js
  await fastify.register(featureRoutes, { prefix: '/api/<feature>' });
  ```
- [ ] (Optional) Seed data in `src/db/seed.js`.

---

## 3. Desktop (`apps/desktop`)

- [ ] **API wrapper** in `src/lib/api/<feature>.js`:
  ```js
  import { api, unwrap } from '../api.js';
  export const featureApi = {
    list: (params) => api.get('/<feature>', { params }).then(unwrap),
    get: (id) => api.get(`/<feature>/${id}`).then(unwrap),
    create: (p) => api.post('/<feature>', p).then(unwrap),
    update: (id, p) => api.put(`/<feature>/${id}`, p).then(unwrap),
    remove: (id) => api.delete(`/<feature>/${id}`).then(unwrap),
  };
  ```
- [ ] **Pages** in `src/pages/<feature>/`:
  - `<Feature>List.jsx` \u2014 `DataTable` + search + `FormModal`.
  - `<Feature>FormModal.jsx` \u2014 controlled inputs, `useMutation`, Zod-driven field errors.
- [ ] **Route** in `src/App.jsx`:
  ```jsx
  <Route path="/<feature>" element={<FeatureList />} />
  ```
- [ ] **Navigation link** in `src/components/layout/Sidebar.jsx`.
- [ ] **UX invariants** (must):
  - Keep the brand palette (`text-brand`, `bg-brand`, `btn-primary`, `bg-surface`).
  - No gradients, no box shadows except `shadow-card`.
  - Always show loading skeleton, error banner, and empty state.
  - Invalidate queries on mutation success; show a toast.

---

## 4. Testing (when we add it)

- Backend: Jest + supertest against a throw-away MySQL database
  (migrations run, seed optional).
- Desktop: Vitest + @testing-library/react for pages; MSW mocks Axios.

---

## 5. Common pitfalls

- **Forgetting `shop_id` on a query** \u2192 cross-shop data leak. Always start
  Knex queries with `.where({ shop_id: shopId, is_deleted: false })`.
- **Adding `.ts` / `.tsx` files** \u2192 pre-commit hook will reject the commit.
- **Using gradient utilities** \u2192 Tailwind config blocks them; do not
  re-enable in `tailwind.config.js`.
- **Duplicating validation** \u2014 never copy Zod schemas between apps.
  Always import from `@wrs/shared`.
