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
# Behind Cloudflare (proxied). nginx needs a cert to start. Canonical strategy = self-signed
# SAN cert (Cloudflare "Full" mode) via the shared, idempotent, self-verifying helper — see
# docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md.
bash scripts/ensure-origin-cert.sh

# The prod nginx joins the shared cmcnew-edge network (to reach the cmcnew-dev app tier).
# It is declared `external` in the compose file, so it must exist before `up` or compose aborts.
# Idempotent + `|| true` because this script runs under `set -e` and re-runs on every deploy.
docker network create cmcnew-edge 2>/dev/null || true

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
