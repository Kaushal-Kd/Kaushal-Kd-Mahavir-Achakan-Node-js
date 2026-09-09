# AGENTS.md — Project Rules for AI Coding Agents

This file instructs AI coding agents (Cursor, Copilot, etc.) on non-negotiable
project rules. Read before making any change.

## 1. Language — JSX only, N EVER TypeScript (Requirements §97)

- Use ONLY `.jsx` (React components) and `.js` (everything else).
- Electron main/config may use `.cjs` / `.mjs` where needed.
- ❌ Never create `.ts`, `.tsx`, `.d.ts`, or `tsconfig.json`.
- ❌ Never add `typescript`, `ts-node`, `tsx`, `@types/*`, or `@typescript-eslint/*` to dependencies.
- ✅ Runtime type safety via **PropTypes + JSDoc + Zod**.
- CI guard: `node scripts/check-no-typescript.js` blocks any TS file.

## 2. Theme — White + `#0C6EE1` only (Requirements §77)

- ❌ No gradients (`bg-gradient-*`, `from-*`, `via-*`, `to-*`).
- ❌ No purple / pink / teal / emerald / orange / indigo brand colors.
- ✅ Flat solid colors. Grayscale for neutrals. Semantic red/yellow/green only for status.
- Tokens: `bg-brand`, `text-brand`, `border-brand`, `bg-surface` (see `tailwind.config.js`).

## 3. Architecture

- Monorepo via npm workspaces: `apps/backend`, `apps/desktop`, `apps/mobile`, `packages/shared`.
- Shared constants / Zod schemas live in `packages/shared` — import via `@wrs/shared`.
- Backend: Fastify + Knex + MySQL.
- Desktop: Electron + React (JSX) + Vite + Tailwind + Zustand + TanStack Query.
- Mobile: React Native (Phase 2).

## 4. Module Pattern (follow everywhere)

Backend: `apps/backend/src/modules/<name>/{routes.js, service.js, schema.js}`.
Desktop: `apps/desktop/src/pages/<feature>/` + `apps/desktop/src/lib/api/<feature>.js`.

Every new feature must:

1. Add Zod schema in `@wrs/shared` (if cross-app) or locally.
2. Add Knex migration (never mutate past migrations).
3. Add service → routes in backend.
4. Add API client method in desktop `src/lib/api`.
5. Add TanStack Query hook in `src/hooks/api`.
6. Add page under `src/pages`.

## 5. Code Style

- Functional React components with hooks only (no class components).
- Default export = component named same as file.
- PropTypes declared under every component.
- Named imports; no `import * as`.
- Tailwind for styling; no inline styles unless dynamic.
- Use shared UI kit in `src/components/ui` — never hand-roll primitives.

## 6. Comments

- No narration comments ("// increment counter"). Only explain non-obvious intent/trade-offs.

## 7. Security

- Never commit `.env`, API keys, GCS credentials, or any secret.
- Passwords always bcrypt (cost ≥ 12).
- All auth routes require JWT + shop scope + permission check.
- All user input validated with Zod before DB write.

## 8. Offline-First

- Every write path must also queue to local `sync_queue` on desktop when offline.
- Use `useOnlineStatus()` hook; hide only features that truly need server.
