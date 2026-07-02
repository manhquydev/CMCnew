#!/usr/bin/env bash
# Idempotent origin-cert provisioner for cmcnew-prod_letsencrypt.
# Canonical strategy: self-signed SAN cert (erp+hoc), accepted by Cloudflare "Full" mode.
# Single source of truth — called by both scripts/prod-server-deploy.sh and Jenkinsfile's
# deploy stage, so the self-signed logic lives in exactly one place.
#
# Behavior:
#   1. Ensure the volume exists (no-op if already present).
#   2. If a cert already exists, skip straight to verify (no package install on the hot path).
#   3. If absent, generate a self-signed RSA-2048 SAN cert (erp+hoc, 10y) into the volume.
#   4. Verify: parseable, not expired, both SANs present. Fail loud on any problem.
#
#   bash scripts/ensure-origin-cert.sh
set -euo pipefail

VOLUME="cmcnew-prod_letsencrypt"
DOMAIN_PRIMARY="erp.cmcvn.edu.vn"
DOMAIN_SECONDARY="hoc.cmcvn.edu.vn"
CERT_PATH="live/${DOMAIN_PRIMARY}/fullchain.pem"
KEY_PATH="live/${DOMAIN_PRIMARY}/privkey.pem"
# Pinned digest (alpine:3.20, pulled+verified from the live VPS's own registry mirror on
# 2026-07-03) — reproducible, previously-tested image rather than whatever :latest resolves to.
ALPINE_IMG="alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"

docker volume create "$VOLUME" >/dev/null

exists() {
  docker run --rm -v "${VOLUME}:/le" "$ALPINE_IMG" test -f "/le/${CERT_PATH}"
}

if ! exists; then
  echo "→ no origin cert found in ${VOLUME}; generating self-signed SAN cert (${DOMAIN_PRIMARY}+${DOMAIN_SECONDARY})"
  docker run --rm -v "${VOLUME}:/etc/letsencrypt" "$ALPINE_IMG" sh -c "
    set -e
    apk add --no-cache openssl >/dev/null 2>&1
    mkdir -p /etc/letsencrypt/live/${DOMAIN_PRIMARY}
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout /etc/letsencrypt/${KEY_PATH} \
      -out /etc/letsencrypt/${CERT_PATH} \
      -subj '/CN=${DOMAIN_PRIMARY}' \
      -addext 'subjectAltName=DNS:${DOMAIN_PRIMARY},DNS:${DOMAIN_SECONDARY}'
  "
fi

# Verify (fail-loud): parseable, not expired, both SANs present.
VERIFY_OUT=$(docker run --rm -v "${VOLUME}:/le" "$ALPINE_IMG" sh -c "
  apk add --no-cache openssl >/dev/null 2>&1
  openssl x509 -in /le/${CERT_PATH} -noout -checkend 0 -subject -enddate -ext subjectAltName 2>&1
") || {
  echo "FATAL: origin cert missing/invalid in ${VOLUME} — run scripts/prod-tls-bootstrap.sh for a real Let's Encrypt cert, or delete the volume to regenerate self-signed" >&2
  exit 1
}

echo "$VERIFY_OUT" | grep -q "$DOMAIN_PRIMARY" && echo "$VERIFY_OUT" | grep -q "$DOMAIN_SECONDARY" || {
  echo "FATAL: origin cert in ${VOLUME} is missing required SANs (${DOMAIN_PRIMARY}, ${DOMAIN_SECONDARY})" >&2
  echo "$VERIFY_OUT" >&2
  exit 1
}

echo "✓ origin cert OK:"
echo "$VERIFY_OUT"
