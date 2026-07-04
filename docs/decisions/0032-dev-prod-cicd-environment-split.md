# 0032 Dev/prod CI/CD environment split with real SSO

Date: 2026-07-04

## Status

Accepted

## Context

The VPS ran a single live stack (`cmcnew-prod`, serving `erp.cmcvn.edu.vn` +
`hoc.cmcvn.edu.vn`) with no pre-production environment. `deverp.cmcvn.edu.vn`
and `devlms.cmcvn.edu.vn` already resolved through Cloudflare but hit the prod
backend — dev traffic and prod traffic were indistinguishable, so no change
could be validated against a realistic SSO-backed environment before it reached
production. The Jenkins pipeline deployed only from `main` and ran integration
tests only for `main` and pull requests, so a `develop` branch had no gated
deploy target.

The box is a single 2-vCPU / 8 GiB VPS with one Jenkins executor and no room
for a second machine. Any pre-prod environment has to share the box, share the
one edge nginx, and stay within measured memory headroom (~5.2 GiB available).

This is a live-architecture and validation-requirements change (new deploy
targets, new auth surface, new data boundary), which the harness classifies as
high-risk and requires a durable decision record for.

## Decision

Run **two Docker Compose stacks on the one VPS behind one shared edge nginx**:

- `cmcnew-prod` (unchanged) serves `erp` / `hoc`; `cmcnew-dev` serves
  `deverp` / `devlms`.
- **Branch-to-environment mapping**: a pull request runs lint + typecheck +
  integration and deploys nothing; `develop` runs the same checks then deploys
  `cmcnew-dev`; `main` runs the same checks then deploys `cmcnew-prod`. Dev
  deploys automatically on every green `develop` build so the pre-prod
  environment never goes stale.
- **Network shape**: an external Docker network (`cmcnew-edge`) is added that
  the prod nginx and the dev `api`/`admin`/`lms` services all join, so nginx
  can route the dev hostnames to dev app containers. Dev `postgres` and `redis`
  stay off that network and off public ports — the dev database and cache are
  never reachable from the edge or from prod.
- **SSO parity**: dev uses the real Entra ID SSO, but with its own redirect URI
  (`https://deverp.cmcvn.edu.vn/api/auth/sso/callback`), its own client secret,
  and dev-scoped cookie names/app origins separate from prod.
- **Data posture**: dev business data is synthetic/demo only. No raw prod DB
  clone unless anonymized and separately approved later.
- **Dev auth convenience**: dev leaves `SEED_MODE` unset (defaults to `full`, so
  every seeded persona gets a real password) and sets
  `STAFF_PASSWORD_LOGIN=true`. This is a deliberate **divergence** from prod,
  whose `api-seed` hardcodes `SEED_MODE: bootstrap` (only super_admin + 2
  directors get a usable password). The divergence is justified by dev's
  synthetic-data-only posture and its test-automation goal; SSO remains the
  primary lane and is still proven end-to-end (see decision 0031 for the
  password-parallel-to-SSO policy this inherits).
- **TLS**: unchanged strategy — Cloudflare "Full" with a self-signed origin SAN
  cert (decision 0029). The `scripts/ensure-origin-cert.sh` SAN list is extended
  to cover the two dev hostnames; the zone is NOT moved to "Full (strict)".

## Alternatives Considered

1. A separate staging VPS. Rejected: cost and operational overhead of a second
   box for a low-traffic pre-prod environment; the current box has measured
   headroom for one capped dev stack.
2. Manual dev deploy (deploy dev only on demand). Rejected: a manually-deployed
   dev environment drifts stale, which defeats the point of a realistic
   SSO-backed pre-prod that mirrors what `main` will ship.
3. Dev as SSO-only (no password login, `SEED_MODE: bootstrap` like prod).
   Rejected: every test persona would then require an interactive, MFA-gated
   Entra login, blocking E2E automation — a gap already hit this cycle
   (`teacher-nav-consolidation.spec.ts` failed for lack of `STAFF_PASSWORD_LOGIN`).
   Option 2 (password + SSO in parallel) solves it with two config lines and no
   new code.
4. Sharing the prod default network with dev. Rejected: it would put dev DB/Redis
   one hostname-resolution away from prod services; the dedicated `cmcnew-edge`
   network limits cross-stack reachability to the app tier only.

## Consequences

Positive:

- A realistic pre-prod environment with real SSO validates changes before they
  reach `erp`/`hoc`, without a second machine.
- Deploy safety improves: PRs can no longer deploy, `develop` and `main` deploy
  only their own environment, and integration runs before any deploy.
- Dev and prod are provably separated via distinct `/api/health` commit markers.

Tradeoffs:

- Extra memory pressure on the 2-vCPU box; mitigated by explicit per-service
  resource caps on the dev stack and by keeping Jenkins at one executor. OOM /
  `docker stats` are watched while the dev stack is brought up.
- Dev runs a lower auth bar than prod (password login for all seeded personas).
  Accepted because dev holds only synthetic data.
- One more edge network and one more stack to reason about during nginx/Jenkins
  changes; mitigated by additive-only nginx edits and by preserving
  `ci.cmcvn.edu.vn`'s Jenkins name resolution when attaching `cmcnew-edge`.

## Follow-Up

- If dev ever needs production-shaped data, add an anonymization/export step and
  record a separate decision before cloning any prod data.
- Keep watching `docker stats` / OOM on the box; if the dev stack pushes the box
  into memory pressure, revisit the dev resource caps rather than raising them
  blindly.
- Prod cutover claims depend on `plans/260702-1109-ops-hardening/` operator
  proofs (backup restore drill + PR-gate demo), which are
  implemented-pending-operator-verification; this split does not itself change
  prod, but the dependency is noted.
