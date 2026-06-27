#!/usr/bin/env sh
# db-backup.sh — dump CMCnew Postgres to a timestamped file.
#
# Usage:
#   ./scripts/db-backup.sh [output-dir]
#
# Defaults:
#   output-dir = ./backups
#   DB credentials from environment (same vars as docker-compose.prod.yml):
#     DB_USER     (default: cmc)
#     DB_PASSWORD (required)
#     DB_NAME     (default: cmc)
#     DB_HOST     (default: localhost)
#     DB_PORT     (default: 5432)
#
# When running against the prod compose stack, the postgres container exposes no
# host port by default. Either add a ports mapping for the backup run or exec
# pg_dump inside the container:
#   docker exec cmcnew-prod-postgres-1 pg_dump -U cmc cmc | gzip > backup.sql.gz
#
# Example (docker exec path):
#   CONTAINER=$(docker ps --filter name=postgres --format '{{.Names}}' | head -1)
#   docker exec "$CONTAINER" pg_dump -U "${DB_USER:-cmc}" "${DB_NAME:-cmc}" \
#     | gzip > "${OUT_DIR}/cmc-$(date +%Y%m%d-%H%M%S).sql.gz"

set -eu

OUT_DIR="${1:-./backups}"
DB_USER="${DB_USER:-cmc}"
DB_NAME="${DB_NAME:-cmc}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${OUT_DIR}/cmc-${STAMP}.sql.gz"

mkdir -p "$OUT_DIR"

echo "Backing up ${DB_NAME} → ${FILE} …"

PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}" \
  pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -Fc \
    "$DB_NAME" \
  | gzip > "$FILE"

echo "Done: $FILE ($(du -sh "$FILE" | cut -f1))"
