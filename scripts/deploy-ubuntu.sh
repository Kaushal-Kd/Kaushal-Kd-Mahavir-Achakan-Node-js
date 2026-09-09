#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wedding_rent_system}"
BRANCH="${BRANCH:-main}"
API_ENV_FILE="${API_ENV_FILE:-$APP_DIR/.env.backend}"
WEB_ENV_FILE="${WEB_ENV_FILE:-$APP_DIR/.env.web}"
REPO_URL="${REPO_URL:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required on the server."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required (docker compose)."
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "Missing git checkout at $APP_DIR and REPO_URL is not provided."
    exit 1
  fi
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd \
  -e docker-compose.override.yml \
  -e apps/backend/.env \
  -e apps/backend/credentials/

if [ -f "$API_ENV_FILE" ]; then
  cp "$API_ENV_FILE" "$APP_DIR/apps/backend/.env"
fi

if [ -f "$WEB_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$WEB_ENV_FILE"
  set +a
fi

# Existing installations may still carry the former cross-origin browser API value.
if [ "${VITE_API_URL:-}" = "https://achakan-api.instabizweb.com/api" ]; then
  export VITE_API_URL="/api"
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE"
  exit 1
fi

docker compose -f "$COMPOSE_FILE" build --pull
# Auth checks need the new tables before the updated backend starts accepting requests.
docker compose -f "$COMPOSE_FILE" run --rm --no-deps backend npm run migrate --workspace @wrs/backend
docker compose -f "$COMPOSE_FILE" up -d

# Best-effort: keep bucket CORS in sync for direct browser uploads.
# This should not block the deployment if GCS is not configured yet.
if ! docker compose -f "$COMPOSE_FILE" run --rm backend npm run gcs:cors --workspace @wrs/backend; then
  echo "Warning: gcs:cors step failed. Upload CORS may need manual setup."
fi

echo "Deployment completed with Docker Compose. Frontend is available on port 6005 and backend on port 4000."
