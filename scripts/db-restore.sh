#!/usr/bin/env sh
# db-restore.sh — restore CMCnew Postgres from a pg_dump archive.
#
# Usage:
#   ./scripts/db-restore.sh <backup-file.sql.gz>
#
# The backup file must be a gzip-compressed pg_dump custom-format archive
# produced by db-backup.sh.
#
# DB credentials from environment:
#   DB_USER     (default: cmc)
#   DB_PASSWORD (required)
#   DB_NAME     (default: cmc)
#   DB_HOST     (default: localhost)
#   DB_PORT     (default: 5432)
#
# WARNING: this drops and recreates the target database. All existing data
# will be lost. Run against a stopped or maintenance-mode application only.
#
# Example:
#   DB_PASSWORD=secret ./scripts/db-restore.sh ./backups/cmc-20260627-120000.sql.gz

set -eu

BACKUP="${1:?Usage: db-restore.sh <backup-file.sql.gz>}"
DB_USER="${DB_USER:-cmc}"
DB_NAME="${DB_NAME:-cmc}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

if [ ! -f "$BACKUP" ]; then
  echo "ERROR: backup file not found: $BACKUP" >&2
  exit 1
fi

echo "Restoring ${DB_NAME} from ${BACKUP} …"
echo "WARNING: this will DROP and recreate the database. Ctrl-C within 5s to abort."
sleep 5

export PGPASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}"

# Drop and recreate the target DB (requires superuser or owner rights)
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

# Restore
gunzip -c "$BACKUP" \
  | pg_restore \
      -h "$DB_HOST" \
      -p "$DB_PORT" \
      -U "$DB_USER" \
      -d "$DB_NAME" \
      --no-owner \
      --role="$DB_USER" \
      -v

echo "Restore complete. Remember to reapply cmc_app role password if needed:"
echo "  psql -U ${DB_USER} -d ${DB_NAME} -c \"ALTER ROLE cmc_app PASSWORD '<password>';\""
