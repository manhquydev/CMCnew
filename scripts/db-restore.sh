#!/usr/bin/env bash
# db-restore.sh — restore CMCnew Postgres (+ optional blob stores) from a backup-db.sh output pair.
#
# Usage:
#   ./scripts/db-restore.sh <backup.sql.gz> [blobs.tar.gz] [target-db]
#
# The SQL file must be a gzip-compressed PLAIN-SQL dump produced by backup-db.sh (pg_dump
# --clean --if-exists, restored via psql — NOT pg_restore/custom-format). The optional blob
# archive is the cmc-blobs-<stamp>.tar.gz sibling also produced by backup-db.sh.
#
# target-db defaults to DB_NAME (or 'cmc'). SAFETY: refuses to run against the literal prod DB
# name ('cmc') unless FORCE=1 is set — always drill into a scratch DB (e.g. cmc_drill).
#
# DB credentials from environment (same as backup-db.sh):
#   PG_CONTAINER (default: cmcnew-prod-postgres-1) — restore runs via docker exec, matching the
#                 backup path (prod postgres exposes no host port).
#   DB_USER      (default: cmc)
#   DB_PASSWORD  (required)
#   PDF_STORE_DIR, SESSION_PHOTO_STORE_DIR — extraction targets for the blob archive.
#
# Example (drill):
#   DB_PASSWORD=secret ./scripts/db-restore.sh ./backups/cmc-20260702-020000.sql.gz \
#     ./backups/cmc-blobs-20260702-020000.tar.gz cmc_drill

set -euo pipefail

BACKUP="${1:?Usage: db-restore.sh <backup.sql.gz> [blobs.tar.gz] [target-db]}"
BLOBS="${2:-}"
PG_CONTAINER="${PG_CONTAINER:-cmcnew-prod-postgres-1}"
DB_USER="${DB_USER:-cmc}"
TARGET_DB="${3:-${DB_NAME:-cmc}}"
PDF_STORE_DIR="${PDF_STORE_DIR:-./.data/pdf}"
SESSION_PHOTO_STORE_DIR="${SESSION_PHOTO_STORE_DIR:-./.data/session-photos}"

if [ ! -f "$BACKUP" ]; then
  echo "ERROR: backup file not found: $BACKUP" >&2
  exit 1
fi

# Guard rail: never restore into the real prod DB name by accident. Drills MUST target a scratch
# DB (e.g. cmc_drill). Set FORCE=1 only for a deliberate, operator-confirmed prod restore.
if [ "$TARGET_DB" = "cmc" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "ERROR: refusing to restore into 'cmc' without FORCE=1. Pass a scratch DB name (e.g. cmc_drill)." >&2
  exit 1
fi

echo "Restoring '${TARGET_DB}' from ${BACKUP} (via docker exec on ${PG_CONTAINER}) …"
echo "Ctrl-C within 5s to abort."
sleep 5

export PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}"

# Plain-SQL restore: matches backup-db.sh's `pg_dump --clean --if-exists`, so DROP/CREATE-per-object
# statements are already embedded in the dump — no separate DROP/CREATE DATABASE step needed. The
# target DB must already exist (create it once: `docker exec ... psql -U $DB_USER -d postgres -c
# "CREATE DATABASE ${TARGET_DB} OWNER ${DB_USER};"` for a fresh scratch DB).
gunzip -c "$BACKUP" \
  | docker exec -i -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" \
      psql -U "$DB_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1

echo "DB restore complete: ${TARGET_DB}"

if [ -n "$BLOBS" ]; then
  if [ ! -f "$BLOBS" ]; then
    echo "ERROR: blob archive not found: $BLOBS" >&2
    exit 1
  fi
  mkdir -p "$PDF_STORE_DIR" "$SESSION_PHOTO_STORE_DIR"
  tar xzf "$BLOBS" -C "$(dirname "$PDF_STORE_DIR")"
  echo "Blob restore complete: extracted ${BLOBS} into $(dirname "$PDF_STORE_DIR")"
fi

echo "Remember to reapply the cmc_app role password on a fresh DB if needed:"
echo "  docker exec -e PGPASSWORD=\$DB_PASSWORD ${PG_CONTAINER} psql -U ${DB_USER} -d ${TARGET_DB} -c \"ALTER ROLE cmc_app PASSWORD '<password>';\""
