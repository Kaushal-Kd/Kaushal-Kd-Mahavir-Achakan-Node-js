# Achakan

Wedding wear rental, sale, and inventory ERP — Desktop + Mobile + Cloud + Offline Sync + Multi-Branch.

Built for sherwani stores, bridal shops, wedding fashion houses, franchises, and multi-branch rental/sale chains.

---

## Stack

| Layer      | Tech                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| Desktop    | Electron + React (JSX) + Vite + Tailwind CSS + Zustand + TanStack Query |
| Mobile     | React Native (Phase 2)                                                  |
| Backend    | Node.js + Fastify + Knex + MySQL                                        |
| Local DB   | better-sqlite3 (desktop) / SQLite (mobile)                              |
| Sync       | PowerSync-ready (stub layer in Phase 1)                                 |
| Auth       | JWT + refresh tokens + bcrypt + device binding                          |
| Validation | Zod (runtime) + PropTypes (UI)                                          |
| Images     | Google Cloud Storage (signed-URL direct upload)                         |
| Styling    | Tailwind v3 — strict white + `#0C6EE1` palette, no gradients            |
| Language   | **JSX / JS only — TypeScript strictly banned (see §97)**                |

---

## Monorepo Layout

```
wedding-rent-system/
├── apps/
│   ├── backend/      Fastify + Knex + MySQL API
│   ├── desktop/      Electron + React (JSX) desktop app
│   └── mobile/       React Native (Phase 2)
├── packages/
│   └── shared/       Shared constants, Zod schemas, utils
├── scripts/          CI guards, API benchmarks (`benchmark-apis.js`)
└── apps/mobile/      Phase 2 stub (see `apps/mobile/README.md`)
```

npm workspaces keep all packages in one install.

---

## Prerequisites

- Node.js 20+ (`.nvmrc`)
- npm 9+
- MySQL 8.x (or MariaDB 10.6+)
- (Optional) Docker for local MySQL

---

## Quick Start

```bash
# 1. Install everything
npm install

# 2. Configure backend env
cp apps/backend/.env.example apps/backend/.env
# Edit DB credentials, JWT secret, GCS (optional)

# 3. Configure desktop env
cp apps/desktop/.env.example apps/desktop/.env

# 4. Create MySQL database
#    (or run the provided docker-compose when added)
mysql -u root -p -e "CREATE DATABASE wedding_rent_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Run migrations + seed super admin
npm run migrate
npm run seed

# 6. Start backend
npm run dev:backend        # http://localhost:4000

# 7. Start desktop app (in a second terminal)
npm run dev:desktop        # launches Electron + Vite dev server
```

Default super admin after seed:

- Email: `admin@wrs.local`
- Password: `Admin@12345`

Change it on first login (change-on-first-login is enforced).

---

## Scripts

| Script                  | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `npm run dev:backend`   | Start Fastify (nodemon; run `migrate` separately) |
| `npm run benchmark:api` | Benchmark hot API paths (needs token + shop id) |
| `npm run dev:desktop`   | Start Electron + Vite concurrently            |
| `npm run dev:web`       | Desktop app in browser (no Electron)          |
| `npm run build:desktop` | Production bundle for Electron                |
| `npm run migrate`       | Run pending Knex migrations                   |
| `npm run seed`          | Seed initial data (admin, categories, sample) |
| `npm run lint`          | Lint all workspaces                           |
| `npm run format`        | Prettier write                                |
| `npm run check:no-ts`   | Fail if any TS file exists (CI guard)         |

---

## CI/CD to Ubuntu (Docker Compose)

This repo includes:

- `.github/workflows/deploy-ubuntu.yml` (CI + SSH deploy)
- `docker-compose.prod.yml` (backend + frontend containers)
- `scripts/deploy-ubuntu.sh` (server-side deploy script)

### 1) One-time Ubuntu setup

```bash
sudo apt update
sudo apt install -y git ca-certificates curl

# Install Docker + Compose plugin if not already installed
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Re-login so docker group is applied
```

Or run single bootstrap command on server (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/scripts/bootstrap-ubuntu.sh -o /tmp/bootstrap-ubuntu.sh
chmod +x /tmp/bootstrap-ubuntu.sh
APP_DIR=/opt/wedding_rent_system \
REPO_URL=git@github.com:<your-org>/<your-repo>.git \
BRANCH=main \
WEB_DOMAIN=achakan.instabizweb.com \
API_DOMAIN=achakan-api.instabizweb.com \
SSL_EMAIL=you@example.com \
ENABLE_SSL=true \
/tmp/bootstrap-ubuntu.sh
```

This one script installs dependencies, configures Nginx, deploys Docker services, and issues SSL certs.

Create backend environment file on server (outside git):

```bash
sudo mkdir -p /opt/wedding_rent_system
sudo tee /opt/wedding_rent_system/.env.backend > /dev/null <<'EOF'
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
# Add DB/JWT/GCS variables used by apps/backend/.env.example
EOF
```

### 2) GitHub repository secrets

Add these repository secrets:

- `UBUNTU_HOST` = server IP/domain
- `UBUNTU_USER` = SSH user
- `UBUNTU_SSH_KEY` = private key content for that user
- `UBUNTU_PORT` = SSH port (optional, defaults to 22)
- `UBUNTU_APP_DIR` = `/opt/wedding_rent_system`
- `UBUNTU_REPO_URL` = your git clone URL (SSH or HTTPS)
- `UBUNTU_API_ENV_FILE` = `/opt/wedding_rent_system/.env.backend`
- `UBUNTU_WEB_ENV_FILE` = `/opt/wedding_rent_system/.env.web`

### 3) Deployment flow

On every push to `main`, GitHub Actions will:

1. run CI (`npm ci`, lint, no-TS guard, desktop build),
2. SSH into your Ubuntu server,
3. update the repo in `UBUNTU_APP_DIR`,
4. run `docker compose -f docker-compose.prod.yml build --pull`,
5. run `docker compose -f docker-compose.prod.yml up -d`,
6. run backend migrations,
7. apply GCS bucket CORS via `npm run gcs:cors` (best-effort).

Frontend is exposed on port `6005` and backend on `4000` (localhost only; publish through Nginx).

You can also trigger deploy manually on server:

```bash
APP_DIR=/opt/wedding_rent_system BRANCH=main bash /opt/wedding_rent_system/scripts/deploy-ubuntu.sh
```

---

## Performance (production API)

- **Production API** runs via Docker on your VPS (`docker-compose.prod.yml`), not Vercel serverless.
- Set `DB_HOST` to `127.0.0.1` or a private IP on the same host/VPC as the API container. A public remote MySQL host adds latency to every request.
- After deploy, run `npm run benchmark:api` with `API_BASE`, `BENCH_EMAIL`, `BENCH_PASSWORD`, and `BENCH_SHOP_ID` to measure p50/p95 on dashboard, orders list, system logs, and trial reminders.
- First backend start with schema changes: `npm --workspace @wrs/backend run dev:migrate` (migrations + nodemon). Day-to-day dev uses `npm run dev:backend` only.

## Project Rules

See `AGENTS.md` — non-negotiable conventions (JSX-only, brand colors, module pattern).

See `docs/ARCHITECTURE.md` and `docs/MODULE-PATTERN.md` when adding new modules.

---

## Phased Delivery

- **Phase 1** (this build) — Desktop ERP Core: auth, shops, users, products, customers, booking, delivery, return, payments, inventory, reports (scaffolded), sync-ready.
- **Phase 2** — React Native mobile (owner dashboard, quick booking, delivery mode).
- **Phase 3** — AI analytics, franchise mode, WhatsApp bots, marketing automation.

---

## License

Proprietary — Instabizweb. All rights reserved.
