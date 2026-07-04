# Dev/prod CI/CD split — autonomous live rollout on the prod VPS

**Date:** 2026-07-04
**Branch:** `devops/dev-prod-cicd-split`
**Plan:** `plans/260703-0052-dev-prod-cicd-environments/` (2× red-team + validate)
**Decision:** `docs/decisions/0032-dev-prod-cicd-environment-split.md`

## What shipped

A second live environment (`cmcnew-dev` → `deverp`/`devlms.cmcvn.edu.vn`) now runs on the same
2-vCPU VPS as prod, behind the one edge nginx, with its own database, Redis, secrets, cookies, and
Entra redirect URI. `develop` deploys dev, `main` deploys prod, PRs validate only. Verified live:
`erp`/`hoc` = prod commit `84ff0d22`, `deverp`/`devlms` = develop commit `8277022` — distinct
health markers prove the split. Prod was never disrupted (zero-downtime edge attach + nginx reloads,
never a restart of the running config path). All 5 phases ran Implement → Review → live → verify →
audit → commit → trace.

## Real bugs / gotchas found and fixed during the run

1. **Prod deploy landmine (code-reviewer CRITICAL).** The prod compose gained `cmcnew-edge` as an
   `external` network, but nothing created it — the next `main` Jenkins deploy would have aborted at
   `docker compose up` ("network not found"). Fixed by encoding `docker network create cmcnew-edge
   2>/dev/null || true` in both deploy paths (`prod-server-deploy.sh` + the Jenkins deploy stage).

2. **`cmc_app` password silently cleared.** Nested SSH single-quoting mangled `$DB_APP_PASSWORD` to
   empty; the RLS role ended up passwordless. Migrate/seed still worked (they use the owner role),
   so it would have surfaced only as a dev-api auth failure. Fixed with heredoc-fed remote scripts +
   injection-safe inlining, then proven by dev-api reaching healthy.

3. **Windows CRLF broke bash on the VPS.** scp'd shell scripts (`ensure-origin-cert.sh`,
   `prod-server-deploy.sh`) carried CRLF; `set -o pipefail\r` failed — and the cert-regen sequence
   had already deleted the old cert before the script errored. Prod kept serving from nginx's
   in-memory cert; fixed by `sed -i 's/\r$//'` + regenerating the 4-SAN cert. Now documented as a
   standing gotcha.

4. **Upstream IP caching.** Recreating any container the prod nginx proxies to (dev app tier, or
   `cmcnew-jenkins` on a Jenkins recreate → transient ci 502) leaves nginx pointing at a stale IP.
   Fix is a zero-downtime `nginx -s reload`; baked into the Jenkins dev deploy stage and the runbook.

5. **`APP_COMMIT` reset on manual recreate.** A bare `up -d dev-api` (no exported `APP_COMMIT`)
   reverted `/health` to `commit: "unknown"`. Jenkins always exports it; the manual path must too.

## Decisions / judgment calls

- Decision numbered **0032**, not the plan's stale "0020" (0020 was already taken).
- Dev reuses the **shared** Entra app's client secret (validated non-interactively via a
  `client_credentials` grant); redirect URI, cookies, DB, and origin are all dev-scoped. A dedicated
  dev secret can be dropped into `.env.dev` later — flagged for optional hardening.
- Cert regeneration was safe to do live because Cloudflare "Full" does not validate the origin SAN.

## Not done autonomously (by design)

- Full interactive Entra login on `deverp` (MFA-gated) — the one genuine human-only step. Everything
  up to it is verified (SSO-start 302 → Entra with the dev redirect URI + host-only `cmc.sso_tx`).
- Live Jenkins CI proof (PR no-deploy, `develop`→dev auto-deploy) fires only after this branch
  merges to `develop`; the Jenkinsfile passes the declarative linter and the manual bring-up already
  proved the dev stack deploys.
