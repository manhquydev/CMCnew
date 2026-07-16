#!/usr/bin/env bash
# Daily Postgres backup for the CMCnew prod stack.
# Usage (cron):  0 2 * * *  /path/to/scripts/backup-db.sh >> /var/log/cmc-backup.log 2>&1
# Env: reads the same .env.production used by the compose stack (DB_USER/DB_NAME/DB_PASSWORD).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
PG_CONTAINER="${PG_CONTAINER:-cmcnew-prod-postgres-1}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Local-disk blob stores referenced by DB rows (exercise.basePdfRef, session evidence photos,
# gift.imageUrl). Must match apps/api/src/services/pdf-store.ts, photo-store.ts, and
# gift-photo-store.ts defaults.
PDF_STORE_DIR="${PDF_STORE_DIR:-./.data/pdf}"
SESSION_PHOTO_STORE_DIR="${SESSION_PHOTO_STORE_DIR:-./.data/session-photos}"
GIFT_PHOTO_STORE_DIR="${GIFT_PHOTO_STORE_DIR:-./.data/gift-photos}"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
DB_USER="${DB_USER:-cmc}"
DB_NAME="${DB_NAME:-cmc}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/cmc-${STAMP}.sql.gz"
BLOBS_OUT="$BACKUP_DIR/cmc-blobs-${STAMP}.tar.gz"

# pg_dump runs as the owner role inside the container; gzip on the way out.
docker exec -e PGPASSWORD="${DB_PASSWORD:-}" "$PG_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip > "$OUT"

echo "$(date -Iseconds) backup OK: $OUT ($(du -h "$OUT" | cut -f1))"

# Blob stores live on the host (bind-mounted into the API container), not inside postgres — tar
# them directly. Missing dirs are tolerated (nothing uploaded yet) so a fresh env doesn't fail.
mkdir -p "$PDF_STORE_DIR" "$SESSION_PHOTO_STORE_DIR" "$GIFT_PHOTO_STORE_DIR"
tar czf "$BLOBS_OUT" -C "$(dirname "$PDF_STORE_DIR")" "$(basename "$PDF_STORE_DIR")" \
  -C "$(dirname "$SESSION_PHOTO_STORE_DIR")" "$(basename "$SESSION_PHOTO_STORE_DIR")" \
  -C "$(dirname "$GIFT_PHOTO_STORE_DIR")" "$(basename "$GIFT_PHOTO_STORE_DIR")"
echo "$(date -Iseconds) blob backup OK: $BLOBS_OUT ($(du -h "$BLOBS_OUT" | cut -f1))"

# Prune old backups (both DB dumps and blob archives, same retention).
find "$BACKUP_DIR" -name 'cmc-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name 'cmc-blobs-*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete

# Restore: use scripts/db-restore.sh <backup.sql.gz> [blobs.tar.gz] [target-db]
