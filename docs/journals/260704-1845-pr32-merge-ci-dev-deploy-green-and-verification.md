# PR #32 merge → first green CI dev deploy + live dev verification

**Date:** 2026-07-04
**PRs:** #32 (dev/prod split), #33 (fix CI smoke race)
**Branch worked:** `devops/fix-dev-smoke-health-wait` → develop

## What happened

Merged the dev/prod CI/CD split (#32) into `develop`, which triggered the first CI-driven dev
deploy. Watched it closely, found and fixed a real race, and verified the live dev environment
functionally.

## The bug the real CI run surfaced

`Build + Deploy (dev)` recreated `dev-api` and the next stage `Smoke (dev)` ran `wget
localhost:4000/health` ~2s later — before Node/Prisma finished booting (dev-api has a
`start_period`). Result: `connection refused`, build FAILURE, even though the deploy itself was
fine (deverp/devlms already served the new commit and dev-api became healthy seconds later).

Fix (#33): wait for the dev-api healthcheck to report healthy before reloading nginx + smoking.
Build #12 (with the fix) went green end-to-end. The prod deploy stage was left untouched — it has
never hit this because its deploy path is longer.

## Verification (live, CI-deployed dev at commit dc63ed6)

- Password login `ketoan@cmc.local` → 200 + `cmc.dev.session` cookie (dev-scoped, ≠ prod
  `cmc.session`), correct user/role. `auth.me` with the cookie returns the user.
- Edge: wrong password → 401; non-existent user → identical 401 (no user enumeration); no-cookie
  `auth.me` → null; SSO-start → 302 to Entra with the dev redirect URI.
- Isolation: dev DB/Redis on `cmcnew-dev_default` only, no host ports, TCP 5432 refused from the
  public IP. Prod stayed `84ff0d22` throughout; ci 200.

## Notes for next time

- Push to `develop` did NOT auto-trigger the Jenkins build (no webhook fired) — had to trigger via
  the Jenkins API. Also saw a stale-index build (#11 built the pre-fix revision because the branch
  job hadn't re-indexed the newer commit). After merging to develop, verify which revision the
  build actually checked out, not just that a build ran.
- Rate limiter did not trip within 7 bad logins (threshold higher); the reject-bad-cred path is
  correct regardless.
