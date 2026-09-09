#!/usr/bin/env bash
set -euo pipefail

# One-time server bootstrap:
# - Installs Docker, Nginx, Certbot
# - Clones repo
# - Creates env files
# - Configures Nginx for web + API domains
# - Optionally issues SSL cert
# - Runs first deploy

APP_DIR="${APP_DIR:-/opt/wedding_rent_system}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"

WEB_DOMAIN="${WEB_DOMAIN:-achakan.instabizweb.com}"
API_DOMAIN="${API_DOMAIN:-achakan-api.instabizweb.com}"
WEB_PORT="${WEB_PORT:-6005}"
API_PORT="${API_PORT:-4000}"

SSL_EMAIL="${SSL_EMAIL:-}"
ENABLE_SSL="${ENABLE_SSL:-false}"

API_ENV_FILE="${API_ENV_FILE:-$APP_DIR/.env.backend}"
WEB_ENV_FILE="${WEB_ENV_FILE:-$APP_DIR/.env.web}"
NGINX_TEMPLATE="${NGINX_TEMPLATE:-$APP_DIR/infra/nginx/achakan.conf.template}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-available/achakan}"

if [ -z "$REPO_URL" ]; then
  echo "REPO_URL is required. Example: git@github.com:org/repo.git"
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (or sudo)."
  exit 1
fi

apt update
apt install -y git curl ca-certificates nginx certbot python3-certbot-nginx gettext-base

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

mkdir -p "$(dirname "$APP_DIR")"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ ! -f "$API_ENV_FILE" ]; then
  cat >"$API_ENV_FILE" <<'EOF'
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
CORS_ORIGIN=https://achakan.instabizweb.com,https://achakan-api.instabizweb.com
DB_HOST=69.62.78.149
DB_PORT=3306
DB_USER=root
DB_PASSWORD=change-me
DB_NAME=wedding_rent_system
JWT_SECRET=change-me-super-strong-secret
EOF
  echo "Created template backend env file at $API_ENV_FILE (please update real values)."
fi

if [ ! -f "$WEB_ENV_FILE" ]; then
  cat >"$WEB_ENV_FILE" <<EOF
VITE_API_URL=/api
EOF
fi

if [ ! -f "$NGINX_TEMPLATE" ]; then
  echo "Nginx template not found: $NGINX_TEMPLATE"
  exit 1
fi

WEB_DOMAIN="$WEB_DOMAIN" API_DOMAIN="$API_DOMAIN" WEB_PORT="$WEB_PORT" API_PORT="$API_PORT" \
  envsubst '${WEB_DOMAIN} ${API_DOMAIN} ${WEB_PORT} ${API_PORT}' <"$NGINX_TEMPLATE" >"$NGINX_SITE_PATH"

ln -sf "$NGINX_SITE_PATH" /etc/nginx/sites-enabled/achakan
nginx -t
systemctl reload nginx
systemctl enable nginx

export APP_DIR BRANCH API_ENV_FILE WEB_ENV_FILE
bash "$APP_DIR/scripts/deploy-ubuntu.sh"

if [ "$ENABLE_SSL" = "true" ]; then
  if [ -z "$SSL_EMAIL" ]; then
    echo "ENABLE_SSL=true requires SSL_EMAIL."
    exit 1
  fi
  certbot --nginx --non-interactive --agree-tos -m "$SSL_EMAIL" -d "$WEB_DOMAIN" -d "$API_DOMAIN"
  sed -i -E 's/listen 443 ssl;/listen 443 ssl http2;/g' "$NGINX_SITE_PATH"
  nginx -t
  systemctl reload nginx
fi

echo "Bootstrap completed."
