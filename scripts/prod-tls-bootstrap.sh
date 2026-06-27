#!/usr/bin/env bash
# One-time: obtain the initial Let's Encrypt SAN cert for both domains via certbot
# --standalone (port 80 must be free — run BEFORE the nginx service is up). Renewals
# afterwards are handled by the in-compose certbot service (webroot, no downtime).
#
# Domains must already resolve to this host (erp.cmcvn.edu.vn, hoc.cmcvn.edu.vn).
# Env: LE_EMAIL (default admin@cmcvn.edu.vn), LE_STAGING=1 to use the staging CA first
# (recommended for a trial run to avoid hitting the production rate limit).
set -euo pipefail

LE_EMAIL="${LE_EMAIL:-admin@cmcvn.edu.vn}"
STAGING_FLAG=""
[ "${LE_STAGING:-0}" = "1" ] && STAGING_FLAG="--staging"

if ss -tlnp 2>/dev/null | grep -q ':80 '; then
  echo "ERROR: port 80 is in use. Stop the nginx service first:" >&2
  echo "  docker compose -f docker/docker-compose.prod.tls.yml stop nginx" >&2
  exit 1
fi

docker run --rm -p 80:80 \
  -v cmcnew-prod_letsencrypt:/etc/letsencrypt \
  -v cmcnew-prod_certbot_www:/var/www/certbot \
  certbot/certbot certonly --standalone $STAGING_FLAG \
  -d erp.cmcvn.edu.vn -d hoc.cmcvn.edu.vn \
  --email "$LE_EMAIL" --agree-tos --no-eff-email --non-interactive

echo "✓ Cert obtained (lineage: erp.cmcvn.edu.vn covers both domains)."
echo "  Next: docker compose -f docker/docker-compose.prod.tls.yml --env-file .env.production up -d"
