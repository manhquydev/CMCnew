---
phase: 2
title: "Dev stack configuration and data isolation"
status: pending
priority: P1
dependencies: [1]
---

# Phase 02: Dev stack configuration and data isolation

## Overview

Create a real dev stack that mirrors prod topology without sharing prod state.
The stack should be cheap enough for the current VPS and isolated enough that
dev mistakes cannot affect prod data.

<!-- Updated: Red Team + Validation Session 1 - cookie/env contracts, Jenkins network, and cmc_app password gate clarified. -->

## Requirements

- Functional: create dev compose, dev env example, separate Postgres, separate Redis, separate app origins, separate cookies.
- Non-functional: cap dev resources, avoid public DB/Redis ports, avoid committing secrets, keep prod compose behavior compatible.

## Architecture

Use a separate compose project:

```text
cmcnew-dev_default
  - dev-postgres
  - dev-redis
  - dev-api
  - dev-admin
  - dev-lms
  - dev-api-migrate
  - optional dev-api-seed profile

cmcnew-edge
  - prod nginx
  - dev-api
  - dev-admin
  - dev-lms
  - cmcnew-jenkins, only if CI routing moves off cmcnew-prod_default
```

Only app-facing dev services join the edge network. Dev Postgres and Redis stay
inside `cmcnew-dev_default`. Preserve `ci.cmcvn.edu.vn`: either keep prod nginx
also attached to `cmcnew-prod_default`, where `cmcnew-jenkins` is already
reachable, or explicitly attach Jenkins to the new edge network with the same
resolvable name.

## Related Code Files

- Create: `docker/docker-compose.dev.tls.yml`
- Create: `.env.dev.example`
- Modify: `docker/docker-compose.prod.tls.yml`
- Modify: `docker/docker-compose.jenkins.yml`
- Possibly modify: `scripts/prod-server-deploy.sh`

## Implementation Steps

1. Create an external Docker network plan named `cmcnew-edge`.
2. Attach prod nginx to `cmcnew-edge` without changing existing prod service names.
3. Add `docker/docker-compose.dev.tls.yml` with service names distinct from prod:
   `dev-postgres`, `dev-redis`, `dev-api`, `dev-admin`, `dev-lms`.
4. Add network aliases on the edge network, for example `cmcnew-dev-api`, `cmcnew-dev-admin`, `cmcnew-dev-lms`.
5. Add dev resource caps. Start conservative:
   - dev Postgres: 1 GiB memory cap.
   - dev API: 768 MiB to 1 GiB memory cap.
   - dev admin and lms: 256 MiB to 512 MiB each.
   - dev Redis: 256 MiB.
6. Add `.env.dev.example` with only variable names and safe placeholders.
7. Require these dev env separations:
   - `DATABASE_URL` points to dev Postgres.
   - `REDIS_URL` points to dev Redis.
   - `ADMIN_APP_ORIGIN=https://deverp.cmcvn.edu.vn`.
   - `AUTH_COOKIE_NAME=cmc.dev.session`.
   - `LMS_COOKIE_NAME=cmc.dev.lms`.
   - `CORS_ORIGINS` includes dev ERP and LMS.
   - `ERP_SSO_REDIRECT_URI=https://deverp.cmcvn.edu.vn/api/auth/sso/callback`.
   - Do not rely on `LMS_APP_ORIGIN` for runtime routing unless implementation first proves a consumer; LMS currently uses `VITE_API_URL=/api` and same-origin nginx routing.
   - `STAFF_PASSWORD_LOGIN=true` (2026-07-04 addition, brainstorm session — inherits decision 0031,
     already permanent on prod; SSO stays the primary onboarding path, password login is an
     additional always-available lane for operator debug/test convenience).
   - Leave `SEED_MODE` unset (defaults to `full` in `packages/db/src/seed.ts:304`) so every seeded
     staff persona (`giao_vien`, `ke_toan`, `hr`, `sale`, `cskh`, `ctv_mkt`, directors) gets a real
     `passwordHash` from `SEED_SUPERADMIN_PASSWORD` at seed time — no manual `user.setPassword` call
     needed per test account. This is the exact mechanism prod already runs on today (confirmed live:
     prod's `.env.production` has no `SEED_MODE` override either). Zero new code required.
8. Mount `/root/cmcnew/.env.dev` into Jenkins as a read-only secret path, matching the existing production pattern.
9. Ensure dev migrations run automatically during deploy. Keep seed as explicit first-install/profile behavior unless the seed command is idempotent.
10. After the first dev migration on a fresh DB, align `cmc_app` password with `DB_APP_PASSWORD`, mirroring `scripts/prod-server-deploy.sh`.

## Success Criteria

- [ ] Dev compose file validates with `docker compose config`.
- [ ] Dev env example has no real secrets.
- [ ] Dev Postgres and Redis do not publish host ports.
- [ ] Dev app services can be addressed from nginx through `cmcnew-edge`.
- [ ] Prod compose still validates after adding the shared edge network.
- [ ] Jenkins can read both `/secrets/.env.production` and `/secrets/.env.dev`.
- [ ] `cmc_app` role password in dev DB matches `DB_APP_PASSWORD` before dev API starts.
- [ ] `ci.cmcvn.edu.vn` remains resolvable from nginx after any network changes.

## Risk Assessment

- Risk: nginx cannot resolve dev service names.
  Mitigation: use a shared external Docker network and explicit network aliases.
- Risk: dev resource use competes with prod.
  Mitigation: add resource caps before starting dev stack.
- Risk: dev seed overwrites useful test state on every deploy.
  Mitigation: run migrations every deploy; keep full seed/reset manual or profile-gated.
- Risk: prod secrets leak into dev.
  Mitigation: separate env files and cookie names; never copy `.env.production`.
- Risk: fresh dev DB cannot serve API because migration creates `cmc_app` with the default password.
  Mitigation: include an explicit `ALTER ROLE cmc_app PASSWORD ...` step after migration.
- Risk: adding an edge network breaks Jenkins vhost resolution.
  Mitigation: preserve the existing prod network attachment or attach Jenkins to the edge network before reload.
