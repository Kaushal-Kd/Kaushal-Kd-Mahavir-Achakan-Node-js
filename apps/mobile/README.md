# @wrs/mobile

React Native companion app for Achakan (requirements §41 &
§88). **Not built in Phase 1** — this package is a placeholder so the
monorepo layout matches the final topology and the shared package
(`@wrs/shared`) can be consumed on day one of Phase 2.

## Phase 2 scope (planned)

- Expo-based app (bare workflow) for iOS & Android.
- Login with the same JWT backend (`apps/backend`).
- Role-aware screens:
  - **Owner / Admin** — dashboards, approvals, reports.
  - **Sales / Cashier** — booking, payments, customer lookup.
  - **Tailor / Laundry / Repair** — job queue, mark complete.
  - **Customer (self-service)** — order tracking, receipts, reminders.
- Offline-first SQLite (react-native-nitro-sqlite or op-sqlite) synced to
  the cloud with the same PowerSync pipeline as desktop.
- GCS image upload via signed URLs (reuses the API from
  `apps/desktop/src/services/gcsUpload.js` pattern).
- Push notifications (FCM/APNS) for reminders, follow-ups, and order status.
- Biometric unlock, PIN-lock, and session timeout matching desktop.

## Why the stub exists now

- Keeps the workspace graph stable (`npm install` wires the app from day one).
- Guarantees Phase 2 reuses the same `@wrs/shared` Zod schemas, enums, and
  utility helpers — no duplicated business rules.
- Makes CI pipelines easy to configure up-front.

## Starting Phase 2

1. `cd apps/mobile`
2. `npx create-expo-app . --template` (bare) — do **not** overwrite
   `package.json` (keep the `@wrs/mobile` name).
3. Add `@wrs/shared` as a workspace dependency.
4. Follow `MODULE-PATTERN.md` in the repo root for consistent module layout.
