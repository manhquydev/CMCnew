# Prod Build Full-Local Bring-Up Report

**Date:** 2026-06-27  
**Branch:** develop  
**Goal:** Runnable full-local prod-like stack seeded with ONLY the IT-head super_admin.

---

## Files Changed

| File | Change |
|---|---|
| `packages/db/src/seed.ts` | Added `SEED_MODE` env switch: `bootstrap` → HQ + IT head only; unset/`full` → existing full demo seed |
| `packages/db/package.json` | Added `"seed:bootstrap": "SEED_MODE=bootstrap tsx src/seed.ts"` |
| `docker/docker-compose.prod.yml` | Added `SEED_MODE: bootstrap` to `api-seed` service environment |
| `docker/.env.prod` | Created (gitignored via `.env.*`) with local-only placeholder credentials |

---

## Issues Fixed During Bring-Up

### Issue 1: Profile services not rebuilt by default `docker compose build`

**Root cause:** `docker compose build` without `--profile` only builds non-profile services (`api`, `admin`, `lms`). The `api-seed` (profile: `seed`) and `api-migrate` (profile: `migrate`) services were NOT rebuilt, so they used a stale cached image with the old `seed.ts` (no SEED_MODE switch). Result: first seed run executed full demo mode.

**Fix:** Explicitly rebuild profile services after the main build:
```sh
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed --profile migrate build --no-cache api-seed api-migrate
```

**Going forward:** The owner's build command below includes `--profile seed --profile migrate` to cover all services.

### Issue 2: `DB_APP_PASSWORD` mismatch

**Root cause:** Migration `20260623045316_rls_tenancy` creates the `cmc_app` role with `PASSWORD 'cmc_app'` (hardcoded). The initial `.env.prod` set `DB_APP_PASSWORD=cmc_app_localdev_2026`, causing API → DB connections to fail with "Authentication failed for cmc_app".

**Fix:** Updated `docker/.env.prod` to `DB_APP_PASSWORD=cmc_app` to match the migration's default. (Post-deploy, change via `ALTER ROLE cmc_app PASSWORD '<new>';` and update `DB_APP_PASSWORD` accordingly.)

### Issue 3: tRPC curl body format

tRPC v11 without a superjson wrapper expects plain JSON input (no `{"json": ...}` envelope) when calling from raw HTTP. The correct format for mutations:
```sh
curl -X POST http://localhost/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"..."}'
```

---

## Build Result

Command:
```sh
# Build all services including profile services
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed --profile migrate build --no-cache

# Then rebuild profile services (redundant after above, but explicit)
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed --profile migrate build --no-cache api-seed api-migrate
```

Result: **All images built successfully** in ~4m28s  
Images: `cmcnew-prod-api`, `cmcnew-prod-admin`, `cmcnew-prod-lms`, `cmcnew-prod-api-migrate`, `cmcnew-prod-api-seed`

---

## Bring-Up Sequence

```sh
# 1. Start postgres + redis
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d postgres redis

# 2. Run migrations (33 applied on clean DB)
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile migrate run --rm api-migrate

# 3. Bootstrap seed (IT head only)
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed run --rm api-seed

# 4. Start all services
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d
```

Migration output: `33 migrations found — All migrations have been successfully applied.`

Seed output:
```
Seed mode: bootstrap
✓ Facility: HQ (#1)
✓ Seeded super_admin (IT head) <it@cmc.local>

Bootstrap complete. Log in as the IT head to create other accounts.
```

---

## Verification Results

### Health check through nginx

```sh
curl -s http://localhost/api/health
```
Response: `{"ok":true}` — **HTTP 200 via nginx**

### IT-head login

```sh
curl -s -c /tmp/cmc-cookies.txt http://localhost/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"it@cmc.local","password":"ItHead@LocalDev2026!"}'
```

Response: **HTTP 200**, session cookie `cmc.session` set  
```json
{"result":{"data":{"user":{"userId":"4f7eedbf-b3e7-4478-a909-eda86fba5439",
  "displayName":"IT Head (Super Admin)","roles":["super_admin"],
  "primaryRole":"super_admin","isSuperAdmin":true,"facilityIds":[1]}}}}
```

### DB bootstrap state (before verification test adds users)

```
 user_count | facility_count
------------+----------------
          1 |              1

email: it@cmc.local | primary_role: super_admin
code: HQ | name: CMC Trụ sở chính
```

### Delegated user creation

**IT head creates Business Director:**
```sh
curl -s -b /tmp/cmc-cookies.txt http://localhost/api/trpc/user.create \
  -H "Content-Type: application/json" \
  -d '{"email":"giamdoc.kd@cmc.local","displayName":"Giám Đốc Kinh Doanh",
       "primaryRole":"giam_doc_kinh_doanh","roles":["giam_doc_kinh_doanh"],
       "facilityIds":[1],"password":"Director@2026!"}'
```
→ **HTTP 200 OK**

**IT head creates Education Director:**
```sh
curl -s -b /tmp/cmc-cookies.txt http://localhost/api/trpc/user.create \
  -H "Content-Type: application/json" \
  -d '{"email":"giamdoc.dt@cmc.local","displayName":"Giám Đốc Đào Tạo",
       "primaryRole":"giam_doc_dao_tao","roles":["giam_doc_dao_tao"],
       "facilityIds":[1],"password":"Director@2026!"}'
```
→ **HTTP 200 OK**

**Business Director logs in and creates sale rep:**
```sh
# Login as director
curl -s -c /tmp/cmc-dir-cookies.txt http://localhost/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"giamdoc.kd@cmc.local","password":"Director@2026!"}'
# → HTTP 200 OK, primaryRole: giam_doc_kinh_doanh

# Director creates sale
curl -s -b /tmp/cmc-dir-cookies.txt http://localhost/api/trpc/user.create \
  -H "Content-Type: application/json" \
  -d '{"email":"sale1@cmc.local","displayName":"Nhân Viên Sale 1",
       "primaryRole":"sale","roles":["sale"],"facilityIds":[1],"password":"Sale@2026!"}'
```
→ **HTTP 200 OK** — user `d8c9f6b2-623e-4193-a78e-bc35ee503082` created

### API error log check

```
docker logs cmcnew-prod-api-1 2>&1 | grep -iE "error|unhandled|500"
```
→ **No output** — API logs clean.

---

## Owner Commands

### A) First-time build and bring up

```sh
# From repo root, run once:
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed --profile migrate build

# Start postgres+redis
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d postgres redis

# Apply migrations
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile migrate run --rm api-migrate

# Bootstrap seed (IT head only)
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed run --rm api-seed

# Bring up all services
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d
```

Access at: **http://localhost**  
IT head login: `it@cmc.local` / `ItHead@LocalDev2026!` (or whatever you set in `docker/.env.prod`)

### B) Reset to clean first-account-only state

```sh
# Tear down everything including volumes (wipes DB)
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod down --volumes

# Bring up fresh postgres+redis
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d postgres redis

# Re-run migrations
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile migrate run --rm api-migrate

# Re-run bootstrap seed
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile seed run --rm api-seed

# Start all services
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d
```

Result: DB contains exactly 1 facility (HQ) and 1 user (IT head).

---

## Final Status

| Check | Result |
|---|---|
| Images build | PASS (~4m28s) |
| 33 migrations applied | PASS |
| Bootstrap seed: 1 facility + 1 user | PASS |
| `/api/health` through nginx | PASS — `{"ok":true}` |
| IT-head login through nginx | PASS — HTTP 200, `super_admin` cookie |
| IT head creates Business Director | PASS — HTTP 200 |
| IT head creates Education Director | PASS — HTTP 200 |
| Director creates sale rep (delegated) | PASS — HTTP 200 |
| API error logs | CLEAN — no errors |

**Prod-like stack: RUNNING. IT-head login through nginx: WORKS.**
