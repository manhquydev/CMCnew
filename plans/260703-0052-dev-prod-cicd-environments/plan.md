---
title: "Dev/prod CI/CD environments with real SSO"
description: "Split CMCnew into realistic dev and prod environments: develop auto-deploys dev, main deploys prod, PRs only validate."
status: pending
priority: P1
branch: "develop"
lane: high-risk
tags: [devops, cicd, docker, jenkins, nginx, sso, cloudflare]
blockedBy: [260703-0022-devops-tier1-hardening]
blocks: []
relatedPlans:
  - plans/260702-1109-ops-hardening/plan.md
  - plans/260630-0919-cicd-observability/plan.md
  - plans/260703-0022-devops-tier1-hardening/plan.md
reviewReports:
  - plans/260703-0052-dev-prod-cicd-environments/reports/from-planner-to-operator-red-team-and-validation-report.md
sourceReports:
  - plans/reports/devops-260703-0024-go-live-cicd-applicability-report.md
  - plans/reports/brainstorm-260703-0033-dev-prod-environment-split-report.md
  - plans/reports/brainstorm-260703-0044-dev-domains-vps-capacity-deploy-policy-report.md
created: "2026-07-03"
createdBy: "ck:plan"
source: skill
---

# Dev/prod CI/CD environments with real SSO

## Overview

This plan turns the research into an implementation roadmap for two live
environments on the current VPS:

```text
PR / changeRequest
  -> lint + typecheck + integration
  -> no deploy

develop
  -> lint + typecheck + integration
  -> deploy cmcnew-dev
  -> smoke https://deverp.cmcvn.edu.vn and https://devlms.cmcvn.edu.vn

main
  -> lint + typecheck + integration
  -> deploy cmcnew-prod
  -> smoke https://erp.cmcvn.edu.vn and https://hoc.cmcvn.edu.vn
```

The selected policy is automatic dev deployment on every green `develop` build.
Manual dev deploy would keep the test environment stale and would reduce the
value of a realistic SSO-backed pre-prod environment. Production remains gated
by PR review and merge to `main`.

## Final Decisions

| Area | Decision |
| --- | --- |
| Dev ERP host | Use `deverp.cmcvn.edu.vn`. DNS resolves today; `deverp.edu.vn` did not resolve during research. |
| Dev LMS host | Use `devlms.cmcvn.edu.vn`. |
| SSO parity | Dev uses real Entra SSO, with a separate redirect URI and separate secrets/cookies from prod. |
| Data posture | Dev may use real identity login, but business data must be synthetic/demo. No prod DB clone unless anonymized and explicitly approved later. |
| Branch model | PR validates only, `develop` deploys dev, `main` deploys prod. |
| VPS capacity | Current VPS is enough for one extra low-traffic dev stack if resource caps are added and Jenkins stays at one executor. |
| Network shape | Keep one public edge nginx. Add an external Docker edge network so nginx can route to dev app services without exposing dev DB/Redis. |
| Safety gate | Do not cut dev domains over until health endpoints prove dev and prod can return different commit markers. |

## Current State

- Prod stack exists as `cmcnew-prod`.
- Jenkins exists as `cmcnew-jenkins` with one executor.
- No `cmcnew-dev` stack exists yet.
- Current nginx only declares prod hostnames: `erp.cmcvn.edu.vn`, `hoc.cmcvn.edu.vn`, `ci.cmcvn.edu.vn`.
- `devlms.cmcvn.edu.vn` and `deverp.cmcvn.edu.vn` currently resolve through Cloudflare but hit the prod backend health response. Treat this as not separated.
- The VPS has comfortable headroom for one dev stack: about 5.4 GiB RAM available, 137 GiB disk free, low load at the time of research.
- `plans/260702-1109-ops-hardening/` is relevant because backup cron/restore drill and PR gate proof are operator-verification items. This plan can start before that proof is complete, but production cutover claims should mention the dependency.
- **`plans/260703-0022-devops-tier1-hardening/` blocks this plan** (found via cross-plan collision check on 2026-07-03, `blockedBy` above): both plans independently propose edits to the same 4 files (`Jenkinsfile`, `docker/docker-compose.prod.tls.yml`, `docker/docker-compose.jenkins.yml`, `scripts/prod-server-deploy.sh`), and 0022's TLS-reconciliation phase (canonical cert strategy, Cloudflare Full-mode confirmation) and CI-gate phase (`publishChecks` on `Jenkinsfile`) are foundational to this plan's own Phase 3/4 (which also touch TLS/Cloudflare mode and the Jenkinsfile). Land and soak-validate 0022 on prod first, then start this plan's Phase 4 (Jenkins branch pipeline split) against the already-reconciled Jenkinsfile/TLS baseline — do not author both plans' Jenkinsfile edits in parallel.

## Scope

In scope:

- Dev Docker compose topology and environment example.
- Separate dev database, Redis, API, admin app, LMS app.
- Shared nginx edge routing for prod and dev hostnames.
- TLS/SAN handling for dev hostnames under Cloudflare.
- Jenkinsfile branch-condition split.
- Dev SSO redirect/cookie/origin parity.
- Durable decision record for the dev/prod split, because this changes live architecture and validation requirements.
- Smoke, rollback, and runbook documentation.

Out of scope:

- New product features.
- Using real student/financial production data in dev.
- Migrating to Kubernetes or GitOps platforms.
- Rebuilding the GitHub Actions pipeline while Jenkins is the active CI.
- Adding a staging environment separate from dev.

## Risk Classification

Lane: high-risk.

Risk flags:

- Auth and SSO redirect behavior.
- External providers: Cloudflare, Entra ID, VPS, Jenkins.
- Data ownership and DB separation.
- Public contracts and deploy behavior.
- Weak proof around current dev hostnames, which already route to prod.

Stop before implementation if any of these appear:

- The intended ERP dev domain is actually `deverp.edu.vn` rather than `deverp.cmcvn.edu.vn`.
- Real prod data is requested for dev without an anonymization plan.
- Cloudflare SSL mode or origin certificate ownership is unclear.
- Jenkins must run more than one executor on the current 2-vCPU VPS.

## Phases

| Phase | Name | Status | Depends |
| --- | --- | --- | --- |
| 1 | [Safety baseline and external prerequisites](./phase-01-safety-baseline-and-external-prerequisites.md) | Pending | none |
| 2 | [Dev stack configuration and data isolation](./phase-02-dev-stack-configuration-and-data-isolation.md) | Pending | 1 |
| 3 | [Edge routing TLS and domain cutover](./phase-03-edge-routing-tls-and-domain-cutover.md) | Pending | 2 |
| 4 | [Jenkins branch pipeline split](./phase-04-jenkins-branch-pipeline-split.md) | Pending | 2, 3 |
| 5 | [SSO parity smoke and rollback runbook](./phase-05-sso-parity-smoke-and-rollback-runbook.md) | Pending | 3, 4 |

## Files Likely To Change

- Create: `docker/docker-compose.dev.tls.yml`
- Create: `.env.dev.example`
- Create: `docs/decisions/0020-dev-prod-cicd-environment-split.md`
- Modify: `docker/docker-compose.prod.tls.yml`
- Modify: `docker/docker-compose.jenkins.yml`
- Modify: `docker/nginx-prod.conf`
- Modify: `Jenkinsfile`
- Modify: `scripts/prod-server-deploy.sh`
- Create or modify: `docs/prod-deploy-security-runbook.md`
- Create: `docs/dev-prod-cicd-runbook.md`

## Acceptance Criteria

- [ ] `docker compose ls` on VPS shows both `cmcnew-prod` and `cmcnew-dev`.
- [ ] Dev DB and Redis are separate from prod and are not exposed on public ports.
- [ ] `https://deverp.cmcvn.edu.vn/api/health` returns the deployed `develop` commit.
- [ ] `https://devlms.cmcvn.edu.vn/api/health` returns the deployed `develop` commit.
- [ ] `https://erp.cmcvn.edu.vn/api/health` and `https://hoc.cmcvn.edu.vn/api/health` keep returning the prod commit.
- [ ] When `develop` and `main` diverge, dev and prod health commit markers differ.
- [ ] Dev SSO login redirects through the dev URI and sets a dev-scoped cookie.
- [ ] PR builds run validation and cannot deploy.
- [ ] `develop` builds run lint, typecheck, and integration before any dev deploy.
- [ ] `develop` builds deploy dev only.
- [ ] `main` builds deploy prod only.
- [ ] Rollback command exists for dev and prod deploy failures.

## Red Team Review

### Session 1 - 2026-07-03

**Findings:** 6 accepted, 0 rejected.
**Severity breakdown:** 1 Critical, 4 High, 1 Medium.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | `develop` deploy could skip integration because current Jenkinsfile only tests `main` and PRs | Critical | Accept | Phase 4, plan acceptance |
| 2 | LMS dev origin was treated as a runtime contract although current code only consumes `VITE_API_URL`/cookies | High | Accept | Phase 2, Phase 5 |
| 3 | SSO transaction cookie is hard-coded, so validation must inspect host-only cookie behavior | Medium | Accept | Phase 5 |
| 4 | TLS certificate plan did not distinguish Cloudflare Full from Full Strict enough | High | Accept | Phase 1, Phase 3 |
| 5 | Shared edge network could break `ci.cmcvn.edu.vn` if Jenkins/nginx name resolution is not preserved | High | Accept | Phase 2, Phase 3 |
| 6 | High-risk architecture change lacked an explicit durable decision record | High | Accept | plan scope, Phase 1, Phase 5 |

#### Evidence Summary

- Current `Jenkinsfile` runs integration only for `main` or `changeRequest()` and deploys only `main`: `Jenkinsfile:36-44`.
- Current `Jenkinsfile` has one global prod compose command: `Jenkinsfile:14-16`.
- API consumes `AUTH_COOKIE_NAME` and `LMS_COOKIE_NAME`: `apps/api/src/context.ts:5-7`.
- API SSO redirect uses `ADMIN_APP_ORIGIN` and a hard-coded `cmc.sso_tx` transaction cookie: `apps/api/src/index.ts:411-429`.
- LMS API client consumes `VITE_API_URL`, not `LMS_APP_ORIGIN`: `packages/ui/src/client.ts:5-12`.
- Current nginx has only prod/CI vhosts and proxies CI to `cmcnew-jenkins`: `docker/nginx-prod.conf:32`, `docker/nginx-prod.conf:133-141`.
- Current Jenkins compose joins the prod network so nginx can resolve `cmcnew-jenkins`: `docker/docker-compose.jenkins.yml:42-54`.
- Current self-signed cert bootstrap covers only `erp.cmcvn.edu.vn` and `hoc.cmcvn.edu.vn`: `scripts/prod-server-deploy.sh:20-29`.
- Harness requires durable decisions for high-risk architecture/data/validation changes: `docs/FEATURE_INTAKE.md:90-95`, `docs/HARNESS.md:317-328`.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, all five `phase-*.md` files.
- Decision deltas checked: 6.
- Reconciled stale references: `LMS_APP_ORIGIN` downgraded from runtime requirement, `develop` integration gate added, cert/TLS mode clarified, Jenkins network preservation added, decision record added.
- Unresolved contradictions: 0.

## Validation Log

### Session 1 - 2026-07-03

**Trigger:** User requested `/ck:plan red-team` and `/ck:plan validate` before implementation.
**Questions asked:** 5 decision topics validated against prior user direction and repo evidence; no blocking user interview was needed because the user had already selected real SSO and asked for expert deploy-policy decision.

#### Verification Results

- **Tier:** Full, because the plan has 5 phases.
- **Claims checked:** 31.
- **Verified:** 25 | **Failed:** 0 | **Unverified:** 6.
- **CLI syntax:** `ck plan validate --strict` passed with 0 errors and 0 warnings.

Unverified items remain as operator confirmations, not plan contradictions:

- Exact ERP dev domain owner intent: `deverp.cmcvn.edu.vn` vs previously mentioned `deverp.edu.vn`.
- Entra redirect URI actor.
- Cloudflare SSL mode in the account.
- Whether a Cloudflare Origin Certificate already exists for all five hostnames.
- Final VPS-side dev `.env` secret availability.
- Real-browser SSO/cookie inspection, which must happen after dev stack exists.

#### Confirmed Decisions

- Deploy policy: PR validation only, `develop` deploys dev after green checks, `main` deploys prod.
- SSO: dev uses real Entra SSO, but with separate redirect URI and dev cookie names.
- Data: dev uses synthetic/demo business data, not a raw prod clone.
- Network: one edge nginx remains, but Jenkins routing must stay resolvable when adding the dev edge network.
- Validation: no implementation is ready until the dev/prod commit marker split is proven.

#### Impact on Phases

- Phase 1: add durable decision record and stricter TLS/cert mode confirmation.
- Phase 2: align dev env requirements with real cookie/env contracts; add `cmc_app` password gate and Jenkins network preservation.
- Phase 3: include all required SANs and CI route preservation.
- Phase 4: require integration on `develop` before dev deploy; split compose variables.
- Phase 5: add SSO transaction cookie inspection and decision-record proof.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, all five `phase-*.md` files.
- Decision deltas checked: 5 validation decisions.
- Reconciled stale references: 5.
- Unresolved contradictions: 0.

## Unresolved Questions

- Confirm whether the ERP dev domain is definitely `deverp.cmcvn.edu.vn`. Research found `deverp.edu.vn` unresolved and `deverp.cmcvn.edu.vn` working. **(Agent-resolvable via DNS lookup — not a human-only blocker.)**
- Confirm who will add the Entra redirect URI: `https://deverp.cmcvn.edu.vn/api/auth/sso/callback`. **(Human-only — Azure AD admin portal access required.)**
- ~~Confirm Cloudflare SSL mode before implementation: Full can use the current self-signed style; Full Strict needs a Cloudflare Origin Certificate or public cert covering all live hostnames.~~ **RESOLVED 2026-07-03:** mode is "Full" per `260703-0022-devops-tier1-hardening`'s locked decision (`docs/decisions/0029-*`), which this plan is `blockedBy` and now matches (Phase 1/3 updated). Still needs a human to confirm the LIVE zone actually shows "Full" (dashboard/API check, no `CF_API_TOKEN` in repo) — that's 0022's own Phase 4 pre-flight responsibility, not re-decided here.

## Pre-Handoff Soundness Review — 2026-07-03

Reviewed for autonomous-execution readiness (not a full new red-team pass — this plan already has its
own Red Team Review + Validation Log above). Findings, all applied:

1. **Real conflict found and fixed:** Phase 1 step 4/5 and Phase 3 step 5 said "prefer Full Strict,"
   contradicting `260703-0022`'s already-locked "Full" decision. This plan is `blockedBy` that plan,
   so re-deciding TLS strategy here would have been a live contradiction an autonomous agent could
   have acted on inconsistently. Fixed: both phases now defer to 0022's decision, `ensure-origin-cert.sh`
   added to Phase 3's file list (SAN extension for the 2 new dev hostnames), Phase 1 now lists explicit
   success criteria referencing "Full" only.
2. **Gap found and fixed:** Phase 4 (Jenkins branch split) never mentioned preserving 0022's prior
   `Jenkinsfile` additions (`publishChecks`, `ensure-origin-cert.sh` call, `COMPOSE_PARALLEL_LIMIT`)
   when restructuring into branch-conditional blocks — real risk of an autonomous rewrite silently
   dropping them. Fixed: Phase 4 Implementation Step 0 added, explicit "extend, don't rewrite" note.
3. **4 genuinely non-automatable human checkpoints identified** (Entra redirect URI registration,
   Cloudflare dashboard/API access for SSL mode + Origin Cert confirmation, Entra client secret for
   the dev app registration, real-browser interactive SSO/cookie inspection) — none of these have any
   credential/API wiring in this repo, so no autonomous agent can complete them regardless of
   instruction. Documented explicitly in Phase 1's new "Human checkpoints" section so an autonomous
   session recognizes these as pause-and-wait points, not decisions to reason through.
4. Acceptance-test mechanization confirmed sound: dev/prod health-check commit-marker divergence
   (Phase 3's core proof) is mechanically `curl`-verifiable; only Phase 5's real-login SSO validation
   requires human judgment, consistent with checkpoint #4 above.

**Verdict: Ready-with-caveats for autonomous execution**, conditional on (a) landing AFTER
`260703-0022` soak-validates on prod (already enforced via `blockedBy`), and (b) the 4 human
checkpoints being satisfied by the operator at the point the autonomous session reaches them — not
before the whole run starts, since earlier phases (1-2 minus the Entra/CF items) don't need them yet.
