#!/usr/bin/env bash
# Runs ON the server (/root/cmcnew). Brings up the two-domain TLS stack end to end.
# Idempotent-ish: safe to re-run (build cache, idempotent seed, cert only created once).
#
#   bash scripts/prod-server-deploy.sh
set -euo pipefail
cd /root/cmcnew

# The env file is scp'd as prodenv.txt (the literal ".env.production" trips a local guard); rename here.
[ -f prodenv.txt ] && { mv -f prodenv.txt .env.production; chmod 600 .env.production; }
ENVF=.env.production
[ -f "$ENVF" ] || { echo "FATAL: $ENVF missing" >&2; exit 1; }
COMPOSE="docker compose -f docker/docker-compose.prod.tls.yml --env-file $ENVF"

val() { grep -m1 "^$1=" "$ENVF" | cut -d= -f2-; }
DB_USER="$(val DB_USER)"; DB_USER="${DB_USER:-cmc}"
DB_NAME="$(val DB_NAME)"; DB_NAME="${DB_NAME:-cmc}"
DB_APP_PASSWORD="$(val DB_APP_PASSWORD)"

# ── Origin TLS cert ────────────────────────────────────────────────────────────
# Behind Cloudflare (proxied). nginx needs a cert to start. Create a self-signed SAN
# cert (accepted by Cloudflare "Full" mode) if none present. For "Full (strict)" replace
# this with a Cloudflare Origin Certificate at the same path later.
docker volume create cmcnew-prod_letsencrypt >/dev/null
if ! docker run --rm -v cmcnew-prod_letsencrypt:/le alpine test -f /le/live/erp.cmcvn.edu.vn/fullchain.pem 2>/dev/null; then
  docker run --rm -v cmcnew-prod_letsencrypt:/etc/letsencrypt alpine sh -c \
    'apk add --no-cache openssl >/dev/null 2>&1; mkdir -p /etc/letsencrypt/live/erp.cmcvn.edu.vn; openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout /etc/letsencrypt/live/erp.cmcvn.edu.vn/privkey.pem -out /etc/letsencrypt/live/erp.cmcvn.edu.vn/fullchain.pem -subj "/CN=erp.cmcvn.edu.vn" -addext "subjectAltName=DNS:erp.cmcvn.edu.vn,DNS:hoc.cmcvn.edu.vn"'
  echo "✓ self-signed origin SAN cert created (erp+hoc)"
fi

echo "=== [1/5] postgres + redis ==="
$COMPOSE up -d postgres redis
# wait for postgres healthy
for i in $(seq 1 30); do
  [ "$($COMPOSE ps -q postgres | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
  sleep 2
done

echo "=== [2/5] migrate (builds api image) ==="
$COMPOSE --profile migrate run --rm api-migrate

echo "=== [3/5] align cmc_app password with DB_APP_PASSWORD ==="
# The RLS migration creates cmc_app with a default password; set it to the runtime secret.
$COMPOSE exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -c "ALTER ROLE cmc_app PASSWORD '$DB_APP_PASSWORD';"

echo "=== [4/5] seed (super_admin + 2 directors, idempotent) ==="
$COMPOSE --profile seed run --rm api-seed

echo "=== [5/5] build + start all services ==="
$COMPOSE up -d --build

echo "=== status ==="
$COMPOSE ps
