---
phase: 4
title: "Jenkins branch pipeline split"
status: pending
priority: P1
dependencies: [2, 3]
---

# Phase 04: Jenkins branch pipeline split

## Overview

Change Jenkins from main-only deploy behavior to an explicit branch policy:
PRs validate only, `develop` deploys dev, `main` deploys prod.

<!-- Updated: Red Team + Validation Session 1 - develop integration gate and compose split clarified. -->

## Requirements

- Functional: branch-aware validation and deploy stages, separate env files, branch-specific smoke URLs.
- Non-functional: no deploy from PR builds, one executor remains sufficient, failed tests stop deploy.

## Architecture

Pipeline gates:

```text
Checkout
  -> install
  -> lint/typecheck
  -> integration tests
  -> branch gate
      PR: stop
      develop: deploy dev + smoke dev
      main: deploy prod + smoke prod
```

The existing Jenkins multibranch job should remain the source of CI signal.
GitHub Actions stays out of scope because billing/runs are currently noisy.

## Related Code Files

- Modify: `Jenkinsfile`
- Modify: `docker/docker-compose.jenkins.yml`
- Possibly modify: `scripts/ci-integration-tests.sh`
- Read: `docker/jenkins-casc.yaml`
- Read: `plans/260702-1109-ops-hardening/phase-03-jenkins-pr-gates.md`

## Implementation Steps

-1. **(2026-07-04 validation Session 2, added)** Before editing `Jenkinsfile`: record current
   `main` HEAD commit and `curl https://erp.cmcvn.edu.vn/api/health` response as the rollback
   reference point (what a Jenkins rebuild-previous-commit should restore).

0. **(2026-07-03 reconciliation, added — was a silent gap)** Before restructuring, confirm this
   phase's rewrite PRESERVES everything 260703-0022 already landed in `Jenkinsfile` (that plan ships
   and soak-validates first, per `blockedBy`): the `publishChecks` start/end calls (Phase 3 of 0022),
   the `bash scripts/ensure-origin-cert.sh` deploy-stage call + `COMPOSE_PARALLEL_LIMIT=1` (Phase 1 of
   0022). Do NOT rewrite the deploy stage from scratch and accidentally drop these — extend the
   existing stage into branch-conditional blocks, keep the cert/publishChecks logic inside the `main`
   branch's deploy path (prod-only concerns) and add the parallel `develop` path alongside it, not
   in place of it.
1. Normalize comments in `Jenkinsfile` so they match actual branch behavior.
2. Ensure PR/change-request stages run lint, typecheck, and integration tests, then stop before deploy.
3. Ensure `develop` also runs integration tests before any dev deploy. Current Jenkins only runs integration for `main` and PRs; that must change.
4. Add dev deploy stages guarded by `branch 'develop'`.
5. Keep prod deploy stages guarded by `branch 'main'`.
6. Replace the single global prod `COMPOSE` variable with explicit branch-targeted commands:
   - dev: `cmcnew-dev`, `/secrets/.env.dev`, `docker/docker-compose.dev.tls.yml`.
   - prod: `cmcnew-prod`, `/secrets/.env.production`, `docker/docker-compose.prod.tls.yml`.
7. Add an explicit post-migrate `cmc_app` password-alignment step for dev and preserve/confirm the existing production behavior.
8. Export `APP_COMMIT` and `APP_BUILT_AT` for both dev and prod deploys.
9. Add branch-specific smoke checks:
   - develop: `deverp.cmcvn.edu.vn`, `devlms.cmcvn.edu.vn`.
   - main: `erp.cmcvn.edu.vn`, `hoc.cmcvn.edu.vn`.
10. Keep Jenkins `numExecutors: 1` unless VPS capacity is revisited.
11. Prove PR no-deploy behavior with a PR build after implementation.

## Success Criteria

- [ ] Jenkinsfile syntax is valid.
- [ ] A PR build cannot enter deploy stages.
- [ ] A `develop` build cannot deploy unless integration passed in that same build.
- [ ] A green `develop` build deploys only `cmcnew-dev`.
- [ ] A green `main` build deploys only `cmcnew-prod`.
- [ ] Failed lint/typecheck/integration prevents deploy on both branches.
- [ ] Smoke output includes branch, commit, builtAt, and URL.

## Risk Assessment

- Risk: deploy stage runs on PR because of incorrect Jenkins branch predicates.
  Mitigation: add explicit `changeRequest()` exclusions around deploy stages.
- Risk: main deploy accidentally uses dev env file or project name.
  Mitigation: centralize branch-to-environment mapping in the Jenkinsfile and echo it before deploy.
- Risk: integration tests overload the VPS.
  Mitigation: keep one executor; revisit port/resource strategy only if executors increase.
- Risk: global prod compose variables leak into dev deployment.
  Mitigation: define explicit `COMPOSE_DEV` and `COMPOSE_PROD` or equivalent local shell variables inside branch-specific deploy blocks.
- Risk: rewriting the deploy stage into branch-conditional blocks silently drops 260703-0022's prior
  Jenkinsfile additions (`publishChecks`, `ensure-origin-cert.sh` call, `COMPOSE_PARALLEL_LIMIT`).
  Mitigation: Implementation Step 0 above — treat 0022's end state as the starting point to extend,
  not a clean slate to rewrite.
