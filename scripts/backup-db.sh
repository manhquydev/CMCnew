#!/usr/bin/env bash
# Daily Postgres backup for the CMCnew prod stack.
# Usage (cron):  0 2 * * *  /path/to/scripts/backup-db.sh >> /var/log/cmc-backup.log 2>&1
# Env: reads the same .env.production used by the compose stack (DB_USER/DB_NAME/DB_PASSWORD).
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
PG_CONTAINER="${PG_CONTAINER:-cmcnew-prod-postgres-1}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
DB_USER="${DB_USER:-cmc}"
DB_NAME="${DB_NAME:-cmc}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/cmc-${STAMP}.sql.gz"

# pg_dump runs as the owner role inside the container; gzip on the way out.
docker exec -e PGPASSWORD="${DB_PASSWORD:-}" "$PG_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip > "$OUT"

echo "$(date -Iseconds) backup OK: $OUT ($(du -h "$OUT" | cut -f1))"

# Prune old backups.
find "$BACKUP_DIR" -name 'cmc-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

# Restore (manual):  gunzip -c <file>.sql.gz | docker exec -i -e PGPASSWORD=$DB_PASSWORD \
#   cmcnew-prod-postgres-1 psql -U $DB_USER -d $DB_NAME
