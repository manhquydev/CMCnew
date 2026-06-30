#!/usr/bin/env bash
# CI: run the API integration suite against a throwaway Postgres, then tear it down.
# Used by the Jenkins pipeline (develop/main only). Self-contained — no external DB.
set -euo pipefail

CID=""
cleanup() { [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

PW=cmc_ci_pw
CID=$(docker run -d --rm -e POSTGRES_USER=cmc -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=cmc \
  -p 55432:5432 postgres:16-alpine)

# wait for readiness
for i in $(seq 1 30); do
  docker exec "$CID" pg_isready -U cmc -d cmc >/dev/null 2>&1 && break
  sleep 1
done

export DIRECT_URL="postgresql://cmc:${PW}@127.0.0.1:55432/cmc?schema=public"
# Apply migrations (creates the cmc_app RLS role), then align its password and point
# the runtime URL at it so the RLS-scoped tests connect as cmc_app.
# prisma validates the schema's url=env(DATABASE_URL) even for migrate deploy, so both
# DATABASE_URL and DIRECT_URL must be set; point DATABASE_URL at the migration (cmc) DSN here.
docker run --rm -v "$WORKSPACE":/app -w /app -e DIRECT_URL="$DIRECT_URL" -e DATABASE_URL="$DIRECT_URL" --network host node:22-alpine sh -c \
  'corepack enable && pnpm install --frozen-lockfile && pnpm --filter @cmc/db generate && pnpm --filter @cmc/db migrate'
docker exec "$CID" psql -U cmc -d cmc -c "ALTER ROLE cmc_app PASSWORD '${PW}';"
export DATABASE_URL="postgresql://cmc_app:${PW}@127.0.0.1:55432/cmc?schema=public"

docker run --rm -v "$WORKSPACE":/app -w /app \
  -e DIRECT_URL="$DIRECT_URL" -e DATABASE_URL="$DATABASE_URL" --network host node:22-alpine sh -c \
  'corepack enable && pnpm install --frozen-lockfile && pnpm --filter @cmc/db generate && pnpm --filter @cmc/api test:integration'
