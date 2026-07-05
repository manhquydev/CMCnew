---
type: brainstorm-report
date: 2026-07-03
lane: normal
intake: 58
skills: [ck:brainstorm, ck:devops, ck:project-organization]
mode: markdown
---

# Dev domains, VPS capacity, and develop deploy policy

## Summary

Recommended decision:

1. Use two dev domains for parity:
   - ERP/admin: `deverp.cmcvn.edu.vn`
   - LMS: `devlms.cmcvn.edu.vn`
2. Enable real SSO in dev, using the same Entra tenant/app, but with separate redirect URIs and separate app cookies.
3. Keep dev + prod on the current VPS for now. Capacity is enough for current low traffic and one Jenkins executor.
4. Deploy `develop` automatically after tests pass. Do not deploy PR builds. Keep `main` as the only prod deploy branch.
5. Add resource caps and strict env/volume separation before turning this on.

One correction: user wrote `deverp.edu.vn`, but local DNS did not resolve that host. `deverp.cmcvn.edu.vn` does resolve through Cloudflare and currently reaches the same backend as prod. This report assumes `deverp.cmcvn.edu.vn` is intended.

## Current evidence

### VPS

Host: `152.42.167.189`, `ubuntu-s-2vcpu-8gb-160gb-intel-sgp1`

Observed 2026-07-02T17:43:28Z:

| Metric | Value |
|---|---:|
| CPU | 2 vCPU |
| Load avg | 0.25 / 0.12 / 0.09 |
| RAM | 7.8 GiB total, 2.4 GiB used, 5.4 GiB available |
| Swap | none |
| Disk `/` | 154 GiB total, 18 GiB used, 137 GiB free |
| Docker images | 14.26 GiB |
| Docker build cache | 11.71 GiB, 8.81 GiB reclaimable |
| Jenkins | 1.33 GiB / 3 GiB cap, 0.33% CPU idle |
| API | ~109 MiB |
| Postgres | ~46 MiB at idle |

Verdict: enough for one additional dev stack now, assuming low traffic and serialized Jenkins builds. Not enough to casually run heavy E2E, parallel builds, and prod traffic together without caps.

### Running containers

Current projects:

- `cmcnew-prod`: api/admin/lms/nginx/certbot/postgres/redis
- `cmcnew-jenkins`: Jenkins controller

No `cmcnew-dev` project exists. No dev env files found under `/root`.

### Domains

- `devlms.cmcvn.edu.vn`: resolves via Cloudflare; `/api/health` returns prod commit.
- `deverp.cmcvn.edu.vn`: resolves via Cloudflare; `/api/health` returns prod commit.
- `deverp.edu.vn`: did not resolve from local machine.

Current nginx on VPS only has:

- `erp.cmcvn.edu.vn`
- `hoc.cmcvn.edu.vn`
- `ci.cmcvn.edu.vn`

So dev domains currently hit the default/fallback path through Cloudflare/nginx and are not separated.

## Problem-first framing

The user is asking about environment split because prod is carrying too much proof burden. The real problem is not "we need more domains"; it is:

- develop changes need real Cloudflare/TLS/nginx/SSO/cookie validation before `main`;
- LMS was previously under-specified in the dev plan;
- CI/CD should create confidence, not create surprise prod changes;
- the current server capacity must be checked, not guessed.

Evidence status: strong enough to proceed to planning. We have repo files, live VPS metrics, live DNS/health observations, and current Jenkins/compose topology.

## Deploy policy decision

### Recommended: auto deploy `develop` after tests pass

Use:

```text
PR build:
  lint + typecheck + integration
  no deploy

develop push:
  lint + typecheck + integration
  deploy dev ERP/LMS
  migrate dev DB
  smoke deverp/devlms

main push:
  lint + typecheck + integration
  deploy prod ERP/LMS
  migrate prod DB
  smoke erp/hoc
```

Why this is the right call for CMCnew:

- `develop` is already the integration branch in repo rules.
- Dev env exists to catch runtime/config/SSO/proxy issues quickly. Manual deploy would let dev drift and reduce value.
- Jenkins already has one global executor, so deploys serialize.
- The project is still actively evolving; fast feedback matters more than release ceremony on dev.

Guardrail:

- Deploy only after green checks.
- Never deploy PR builds.
- Add a manual "re-deploy dev" option for reruns.
- Allow an emergency opt-out commit marker later if needed, but do not make manual deploy the default.

Manual deploy after tests is weaker here: it creates a stale dev environment unless the operator is disciplined. For this project, stale dev is worse than a slightly noisy auto-deploy.

## SSO decision

Enable real SSO in dev. This matches the user's goal and is technically appropriate.

Required:

- Add Entra redirect URI: `https://deverp.cmcvn.edu.vn/api/auth/sso/callback`
- Set dev `ERP_SSO_REDIRECT_URI` to that exact URL.
- Set dev `ADMIN_APP_ORIGIN=https://deverp.cmcvn.edu.vn`.
- Set dev `CORS_ORIGINS=https://deverp.cmcvn.edu.vn,https://devlms.cmcvn.edu.vn`.
- Use separate dev cookie names:
  - `AUTH_COOKIE_NAME=cmc.dev.session`
  - if LMS cookie env is supported/used, set a distinct dev LMS cookie too.
- Keep dev staff/user data synthetic or clearly marked. Real SSO identity can log in, but dev business records must not become operational truth.

Why real SSO is acceptable:

- It catches actual redirect/cookie/domain/tenant issues.
- It avoids a fake auth surface that passes dev but fails prod.
- It is still safe if dev DB and app secrets are separate.

## Topology recommendation

Use same VPS + second compose project:

- `cmcnew-prod`
- `cmcnew-dev`

Separate all mutable state:

- `cmcnew-prod_pgdata` vs `cmcnew-dev_pgdata`
- `cmcnew-prod_redisdata` vs `cmcnew-dev_redisdata`
- `.env.production` vs `.env.dev`
- prod DB credentials vs dev DB credentials
- prod JWT secret vs dev JWT secret

Nginx vhosts:

- `deverp.cmcvn.edu.vn` -> dev admin + dev API
- `devlms.cmcvn.edu.vn` -> dev LMS + dev API
- `erp.cmcvn.edu.vn` -> prod admin + prod API
- `hoc.cmcvn.edu.vn` -> prod LMS + prod API

Certificate:

- Existing origin cert path only covers `erp/hoc` today.
- For Cloudflare Full mode, self-signed SAN can include all four domains.
- For Full Strict, install Cloudflare Origin Certificate or real cert covering all four domains.

## Required safeguards before implementation

1. Add resource caps:
   - Jenkins already capped at 1.5 CPU / 3 GiB.
   - Add conservative caps for dev API/Postgres, e.g. dev API 512 MiB, dev Postgres 512 MiB-1 GiB.
   - Consider prod API/Postgres caps or reservations before real prod traffic.
2. Keep Jenkins executor count at `1`.
3. Add `nginx -t` before restarting nginx in deploy pipeline.
4. Smoke commit match:
   - expected = `GIT_COMMIT`
   - actual = `/api/health.commit`
   - fail deploy if mismatch.
5. Add dev label/banner in UI if cheap, or at least health/env response. This prevents mistaking dev for prod.
6. Install backup cron + run restore drill before calling prod final; dev does not replace backup proof.

## What not to do

- Do not use the same DB with a `NODE_ENV=dev` flag. This would be a data safety bug.
- Do not deploy every feature branch. Use PR checks only.
- Do not run full Playwright on every push at first. Add a small dev smoke first; expand later.
- Do not expose Postgres/Jenkins/Grafana publicly.
- Do not add Kubernetes for this.

## Suggested acceptance criteria

- `https://deverp.cmcvn.edu.vn/api/health` returns dev commit and is different from prod when develop is ahead.
- `https://devlms.cmcvn.edu.vn/` serves LMS dev.
- `https://deverp.cmcvn.edu.vn/auth/sso/login` redirects to Microsoft and callback returns to dev domain.
- `develop` push deploys dev only after green lint/typecheck/integration.
- `main` push deploys prod only.
- PR builds never deploy.
- `docker compose ls` on VPS shows both `cmcnew-prod` and `cmcnew-dev`.
- Dev DB contains seeded/demo data only.

## Files likely touched later

- `Jenkinsfile`
- `docker/docker-compose.dev.tls.yml` (new)
- `docker/nginx-prod.conf`
- `.env.dev.example` (new)
- `docs/dev-prod-cicd-runbook.md` (new) or update `docs/prod-deploy-security-runbook.md`
- possibly `scripts/dev-server-deploy.sh` (new)

## Open issue to confirm

- Confirm ERP dev host is `deverp.cmcvn.edu.vn`, not `deverp.edu.vn`. The former resolves; the latter did not.
