#!/usr/bin/env bash
# Build a complete .env.production WITHOUT printing any secret value.
#   SSO + Graph credentials are copied from a SOURCE env (the org's existing .env).
#   DB / JWT / seed-admin secrets are MINTED FRESH (never reuse dev secrets in prod).
#
# Usage:
#   bash scripts/prod-build-env.sh <source-env> <output-env>
#   # e.g. bash scripts/prod-build-env.sh .env .env.production
#
# The output file is chmod 600. It is intended to be scp'd to the server and kept
# out of git (.env.production is gitignored).
set -euo pipefail

SRC="${1:?source env path required}"
OUT="${2:?output env path required}"
[ -f "$SRC" ] || { echo "source env not found: $SRC" >&2; exit 1; }

# Pull a key's value from the source env (value may contain '='); empty if absent.
val() { grep -m1 "^$1=" "$SRC" 2>/dev/null | cut -d= -f2- || true; }

ENTRA_TENANT_ID="$(val ENTRA_TENANT_ID)"
ENTRA_CLIENT_ID="$(val ENTRA_CLIENT_ID)"
ENTRA_CLIENT_SECRET="$(val ENTRA_CLIENT_SECRET)"
GRAPH_CLIENT_SECRET="$(val GRAPH_CLIENT_SECRET)"
GRAPH_SENDER_NOTIFY="$(val GRAPH_SENDER_NOTIFY)"
GRAPH_SENDER_PAYROLL="$(val GRAPH_SENDER_PAYROLL)"
GRAPH_SENDER_HR="$(val GRAPH_SENDER_HR)"
BREVO_API_KEY="$(val BREVO_API_KEY)"
BREVO_SENDER_EMAIL="$(val BREVO_SENDER_EMAIL)"
BREVO_SENDER_NAME="$(val BREVO_SENDER_NAME)"

# Fall back to ENTRA secret for Graph if a dedicated GRAPH_CLIENT_SECRET is not set
# (same app registration is reused for SSO + Graph client-credentials).
[ -n "$GRAPH_CLIENT_SECRET" ] || GRAPH_CLIENT_SECRET="$ENTRA_CLIENT_SECRET"

gen() { openssl rand -base64 "${1:-36}" | tr -d '\n/+=' | cut -c1-"${2:-40}"; }
DB_PASSWORD="$(gen 36 40)"
DB_APP_PASSWORD="$(gen 36 40)"
JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
SEED_SUPERADMIN_PASSWORD="$(gen 30 24)"

umask 077
cat > "$OUT" <<EOF
DB_USER=cmc
DB_NAME=cmc
DB_PASSWORD=${DB_PASSWORD}
DB_APP_PASSWORD=${DB_APP_PASSWORD}
JWT_SECRET=${JWT_SECRET}
COOKIE_SECURE=true
ADMIN_APP_ORIGIN=https://erp.cmcvn.edu.vn
CORS_ORIGINS=https://erp.cmcvn.edu.vn,https://teacher.cmcvn.edu.vn,https://hoc.cmcvn.edu.vn
STAFF_APP_ORIGINS=https://erp.cmcvn.edu.vn,https://teacher.cmcvn.edu.vn
ENTRA_TENANT_ID=${ENTRA_TENANT_ID}
ENTRA_CLIENT_ID=${ENTRA_CLIENT_ID}
ENTRA_CLIENT_SECRET=${ENTRA_CLIENT_SECRET}
STAFF_EMAIL_DOMAIN=cmcvn.edu.vn
SSO_ENABLED=true
ERP_SSO_REDIRECT_URI=https://erp.cmcvn.edu.vn/api/auth/sso/callback
GRAPH_CLIENT_SECRET=${GRAPH_CLIENT_SECRET}
GRAPH_SENDER_NOTIFY=${GRAPH_SENDER_NOTIFY}
GRAPH_SENDER_PAYROLL=${GRAPH_SENDER_PAYROLL}
GRAPH_SENDER_HR=${GRAPH_SENDER_HR}
BREVO_API_KEY=${BREVO_API_KEY}
BREVO_SENDER_EMAIL=${BREVO_SENDER_EMAIL}
BREVO_SENDER_NAME=${BREVO_SENDER_NAME}
SEED_SUPERADMIN_EMAIL=admin@cmcvn.edu.vn
SEED_SUPERADMIN_PASSWORD=${SEED_SUPERADMIN_PASSWORD}
DISABLE_CRON=0
EOF
chmod 600 "$OUT"

# Report ONLY presence/absence — never values.
echo "Wrote $OUT (chmod 600)"
echo "  SSO (Entra) config: $([ -n "$ENTRA_CLIENT_ID" ] && echo present || echo MISSING)"
echo "  Graph senders:      $([ -n "$GRAPH_SENDER_NOTIFY" ] && echo present || echo MISSING)"
echo "  Brevo external mail:$([ -n "$BREVO_API_KEY" ] && [ -n "$BREVO_SENDER_EMAIL" ] && echo ' present' || echo ' MISSING')"
echo "  Fresh secrets minted: DB_PASSWORD, DB_APP_PASSWORD, JWT_SECRET, SEED_SUPERADMIN_PASSWORD"
echo "  Break-glass admin password is in $OUT (SEED_SUPERADMIN_PASSWORD) — retrieve via SSH."
