# DevOps / Config Prod-Readiness Assessment — CMCnew

Date: 2026-06-27 | Branch: feature/erp-unify-rbac-f0 | Mode: read-only
Scope: internal school ERP+LMS (student PII, payments, payroll). Goal: judge if config/infra is professional and production-appropriate, and what is needed to "build full local like prod".

## Verdict

A genuine prod-like stack already exists: 4 Dockerfiles + `docker/docker-compose.prod.yml` + an outer nginx reverse proxy serving the unified app on **one origin** (`/` admin, `/teaching/`, `/lms/`, `/api`). This is well above typical greenfield maturity. The remaining gaps are operational hardening (TLS, backups, secret rotation, healthchecks), not missing scaffolding.

---

## 1. Containerization

Current state:
- `docker/docker-compose.prod.yml` — full stack: postgres, redis, api, api-migrate (profile), api-seed (profile), admin, teaching, lms, nginx. Single public port (`${NGINX_PORT:-80}:80`).
- Reverse proxy **present and correct** — `docker/nginx.conf:26-67`: `/api/` → `api:4000` (prefix stripped, SSE buffering off, 3600s timeouts, 20M body), `/teaching/`, `/lms/` prefix-stripped, `/` catch-all → admin. Inner SPA config `docker/nginx-spa.conf` (try_files fallback, 1y immutable asset cache, gzip). This is the "full local like prod" unified-origin build the operate guide implies — it exists.
- Frontend Dockerfiles are **multi-stage** (`apps/admin/Dockerfile:12-48` build → nginx runner; teaching/lms identical with `VITE_BASE_URL`). Build args bake `VITE_API_URL=/api` so all apps are same-origin.
- API Dockerfile `apps/api/Dockerfile` — single-stage (justified: pnpm isolated-linker symlinks break on multi-stage `node_modules` copy, `apps/api/Dockerfile:4-7`). **Runs non-root** (`apps/api/Dockerfile:50-51` addgroup/adduser + `USER cmc`). Layer order manifests→install→prisma generate→source for cache efficiency.
- `.dockerignore` proper (excludes host node_modules, .git, all `.env.*` except `.env.production.example`).
- Healthchecks: postgres (`pg_isready`) and redis (`redis-cli ping`) have them; api `depends_on` both with `condition: service_healthy`.

Gaps:
- **API service has NO healthcheck** (`docker-compose.prod.yml:62-91`). nginx `depends_on: [api, admin, teaching, lms]` with **no `condition: service_healthy`** (`:165-169`) → nginx can start and proxy before api/SPAs are ready; no auto-restart on unhealthy api. `/health` endpoint exists (`apps/api/src/index.ts:44`) but is unused by Docker.
- **No TLS** in the topology — port 80 only. Acceptable for local-prod parity; a real launch needs 443 + certs (see P0-1).
- SPA containers also lack healthchecks (low impact).

## 2. Config / Secrets

Current state:
- Only `.env.example` is git-tracked (verified `git ls-files`). `.env`, `.env.production`, `.env.local-docker` exist on disk but are **gitignored and untracked** — no secrets in repo.
- `.env.production.example` is a complete, well-commented template with `CHANGE_ME_*` placeholders and `openssl rand -hex 32` guidance.
- Compose enforces required secrets via fail-fast: `${DB_PASSWORD:?...}`, `${JWT_SECRET:?...}`, `${DB_APP_PASSWORD:?...}`, seed creds (`docker-compose.prod.yml:38,75,71,120-121`).
- **Production CORS guard**: `apps/api/src/index.ts:32-34` throws if `NODE_ENV=production` and `CORS_ORIGINS` unset — prevents silent localhost fallback.
- `COOKIE_SECURE` handled consistently: staff login `routers/auth.ts:43`, LMS `routers/lms-auth.ts:30`, SSO `index.ts:248` — all `secure: process.env.COOKIE_SECURE !== 'false'` (Secure by default, opt-out only). SameSite=Lax everywhere; httpOnly set.
- RLS-aware DB creds: runtime uses non-owner `cmc_app` (RLS applies); migrate/seed use owner via `DIRECT_URL` (bypasses RLS).

Gaps:
- **Weak default `DB_APP_PASSWORD=cmc_app`** baked into migration `20260623045316_rls_tenancy` and `.env.production.example:24`. The "change it manually post-migrate via psql ALTER ROLE then update env + restart" dance (`docker-compose.prod.yml:23-27`, `.env.production.example:18-23`) is fragile and easily skipped — a real launch with this default unchanged is an exposed DB credential. See P0-3.
- `.env.example` ships real-looking Entra tenant/client IDs (`index.ts` consumers; `.env.example:38-39`) — not secrets (secret is empty), but worth confirming these are non-sensitive public app-registration IDs.
- No secret manager; env-file only. Acceptable for single-host internal deploy if file perms are tight.

## 3. Build / CI

Current state:
- `turbo.json` — build/typecheck/test with `^build` deps, dev non-cached/persistent, e2e wired. Root scripts in `package.json` cover dev/build/lint/typecheck/test/test:e2e/db:*.
- `.github/workflows/ci.yml` — solid self-contained pipeline: postgres service, prisma generate → migrate → seed → **verify-rls.ts (done-evidence)** → `pnpm -r typecheck` → unit tests → api integration tests → build. Uses ci-only secrets (fine for CI).
- **The 3 "@azure typecheck errors" are NOT present** — `pnpm --filter @cmc/api typecheck` runs clean (verified this session). `@azure/identity` + `@azure/msal-node` are real deps (`apps/api/package.json:18-19`) used by `lib/sso.ts` + `lib/graph-client.ts`. No fix/exclude needed.
- Node 22, pnpm 10.24.0 pinned via `packageManager` + `engines`.

Gaps:
- CI **does not run** — GitHub Actions blocked by account billing (private repo). Documented operator decision: Jenkins planned, verify locally meanwhile (`DEBT.md`). `ci.yml` triggers only on `push: [main]` + PR; with billing blocked this is reference-only. P1: stand up Jenkins or local pre-push hook running the same chain.
- No lint step in CI (`pnpm -r lint` exists but is not a CI gate).

## 4. DB Ops

Current state:
- Real migration history: 30 migrations under `packages/db/prisma/migrations/` (init → RLS tenancy → domain phases). `migrate` = `prisma migrate deploy` (`packages/db/package.json`).
- First-deploy runbook documented in compose header (start postgres → `api-migrate` profile → `api-seed` profile → up).
- RLS posture is strong: dedicated `cmc_app` non-owner runtime role, `verify-rls.ts` asserts isolation as CI done-evidence.
- Idempotent seed (`seed.ts`), plus demo/lms seeds.

Gaps:
- **No backup/restore story** — no scheduled `pg_dump`, no documented restore. For PII + payments + payroll this is the single biggest data-loss risk. See P0-2.
- Migrations are **manual** (one-off profiles), not an init/release step — operator-dependent; easy to forget on redeploy. P1: a documented release script (`migrate` then `up`) or an init-container.
- pgdata is a local named volume (`pgdata:`) — no offsite/replicated durability.

## 5. Observability

Current state:
- `/health` endpoint (`index.ts:44`) returns `{ok:true}`.
- Cron job logs are conditional and informative (`index.ts:316-345`).
- Error handling in file/receipt endpoints is deliberate (RLS-invisible vs missing not distinguished — good security posture, `index.ts:112`).

Gaps:
- **No structured logging** — `console.log` only; no `hono/logger`, no request logging, no request IDs, no log levels.
- No metrics/error aggregation (Sentry/OTel). Acceptable for v1 internal, but no visibility into prod failures.
- nginx access/error logs go to container stdout only (no rotation/retention plan).

## 6. Security Quick-Scan

Positives: non-root api, no secrets in repo, CORS prod guard, Secure+httpOnly+Lax cookies, RLS enforced at DB, **login rate limiter** (`apps/api/src/rate-limit.ts` — per-IP + per-(IP,identifier), failed-attempts-only, in-process; topology note documents the single-instance assumption and the Redis migration trigger).

Gaps:
- **No HTTP security headers** — no `helmet`/`secureHeaders`, no HSTS, X-Frame-Options, X-Content-Type-Options, CSP (neither in Hono nor outer nginx). P1.
- No TLS → cookies/PII in cleartext on the wire if launched as-is (P0-1).
- Rate limiting is app-layer only; no nginx per-IP backstop (the code comment invites one as defense-in-depth). P2.
- `client_max_body_size` only on `/api/` (20M) — fine.

---

## Prioritized Recommendations

### P0 — blocks a real operational launch
1. **TLS termination + Secure cookies.** Add an nginx `443` server block with certs (Let's Encrypt/companyCA) or document a required external TLS proxy; bind 80→301 redirect. Set `COOKIE_SECURE=true` (leave unset) and add HSTS only once TLS is on. Without this, session cookies + student PII + payment data travel in cleartext. (Local-prod parity build can stay HTTP with `COOKIE_SECURE=false`; the launch profile must be TLS.)
2. **Database backup/restore.** Add a scheduled `pg_dump` (cron sidecar or host cron) writing to a separate volume/offsite target + a tested restore runbook in `docs/`. Mandatory before storing real payroll/payment/PII.
3. **Rotate the default DB credentials and remove the fragile manual dance.** Generate `DB_PASSWORD`, `DB_APP_PASSWORD`, `JWT_SECRET` per deploy; either parameterize the `cmc_app` password in the RLS migration via env (so it is never the literal default) or make the post-migrate `ALTER ROLE` a scripted, non-optional step. Shipping with `DB_APP_PASSWORD=cmc_app` is an exposed runtime DB credential.

### P1 — hardening before scale / steady-state
- Add an **API healthcheck** (`test: wget -qO- http://localhost:4000/health`) and gate nginx with `depends_on: api: condition: service_healthy`; add `restart: unless-stopped` already present — pair with healthcheck for auto-recovery.
- Add **security headers** via Hono `secureHeaders()` middleware and/or outer nginx `add_header` (HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, CSP).
- **Structured logging + request logging** (`hono/logger` or pino) with request IDs; decide log retention.
- **Migrations as a release step** — a `deploy.sh` (or init-container) that runs `api-migrate` then `up`, so redeploys never skip migrations.
- **Stand up the CI runner** (Jenkins per the documented decision) executing the existing `ci.yml` chain, or a local pre-push hook; add `pnpm -r lint` as a gate.

### P2 — nice-to-have
- nginx coarse per-IP rate-limit (`limit_req`) as defense-in-depth for `/api/`.
- SPA container healthchecks.
- Error aggregation (Sentry) / OTel traces.
- Move the local-disk PDF store to MinIO/S3 with secret-managed creds (already tracked in `DEBT.md`).

---

## Answers to lead questions
- **Does a prod-like local build exist today? YES.** `docker compose -f docker/docker-compose.prod.yml --env-file .env.production up` builds all 4 images and serves admin `/`, teaching `/teaching/`, lms `/lms/`, api `/api` behind one nginx on a single origin. The reverse proxy the operate guide implies is real and correctly configured (SSE-aware, prefix-stripping). For HTTP-local parity set `COOKIE_SECURE=false`.
- **Top 3 P0 items:** (1) TLS + Secure cookies for the launch profile; (2) DB backup/restore (no backup exists today); (3) rotate/parameterize the default `cmc_app`/DB/JWT secrets (default `DB_APP_PASSWORD=cmc_app` ships exposed).

## Unresolved questions
- Are the Entra tenant/client IDs in `.env.example` truly non-sensitive public app-registration IDs (safe to keep committed)?
- Launch target: single host (env-file is fine) or multi-replica (then rate-limiter + SSE must move to the declared-but-unused Redis)?
- Is the 3-error "@azure typecheck" note stale? Confirmed clean this session — assuming already fixed.

---

## Follow-up: hardening applied (2026-06-27)

**Done in this session:**

- `apps/teaching/` deleted; teaching service removed from `docker-compose.prod.yml` and nginx `depends_on`; `/teaching/` location block removed from `nginx.conf`; teaching e2e specs (`teaching-smoke.spec.ts`, `teaching-navigation.spec.ts`) and the playwright webServer entry removed.
- **API healthcheck** added to `docker-compose.prod.yml` (`wget -qO- http://localhost:4000/health`, 10 s interval, 5 retries, 15 s start_period). nginx `depends_on` updated to `condition: service_healthy` for api; admin/lms use `service_started`.
- **Security headers** added to `nginx.conf` server block: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, conservative CSP (`default-src 'self'` + `unsafe-inline` for scripts/styles needed by Vite SPAs + `data: blob:` for images + `connect-src 'self'` for tRPC/SSE). HSTS intentionally skipped (local stack is HTTP).
- **DB backup/restore scripts** added: `scripts/db-backup.sh` (pg_dump custom-format → gzip), `scripts/db-restore.sh` (drop + recreate + pg_restore). Both are POSIX sh, credential-safe (PGPASSWORD from env, no hardcoded values).

**Residual P0s still open (require operator action before real launch):**

| # | Item | Why blocked here |
|---|------|-----------------|
| P0-1 | TLS termination (nginx 443 + cert) + HSTS + `COOKIE_SECURE=true` | Needs real certs; local stack stays HTTP. Template: add `ssl_certificate`/`ssl_certificate_key` directives and a 80→443 redirect block to `nginx.conf` when certs are provisioned. |
| P0-2 | Schedule `db-backup.sh` (host cron or sidecar) + offsite copy | Scripts exist; operator must wire host cron (`0 2 * * * DB_PASSWORD=… /path/db-backup.sh /backups`) and test a restore before go-live. |
| P0-3 | Rotate `DB_APP_PASSWORD` away from default `cmc_app` | Requires running `ALTER ROLE cmc_app PASSWORD '…'` post-migrate and updating `DB_APP_PASSWORD` in the env file. Cannot be automated without touching the migration SQL (risk of breaking existing deploys). |
