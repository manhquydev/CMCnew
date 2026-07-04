---
title: "Safe feature consolidation: integrate UI rebuild + Plan A/B/C/D to develop, then promote prod"
description: "Merge 5 open feature branches (phase-d UI rebuild + Plan A/B/C/D) onto develop cleanly, verify on the live dev env, then promote to prod — without losing or breaking any implemented code."
status: implemented
priority: P1
branch: "develop"
lane: high-risk
tags: [integration, git, cicd, release, ui, prod-promote]
blockedBy: []
blocks: []
relatedPlans:
  - plans/260703-0052-dev-prod-cicd-environments/plan.md
sourceReports:
  - plans/reports/deep-audit-260704-1927-develop-missing-feature-merges-and-dev-ui-gap-report.md
  - plans/reports/brainstorm-260704-1935-safe-integration-develop-first-feature-consolidation-report.md
created: "2026-07-04"
createdBy: "ck:plan"
source: skill
---

# Safe feature consolidation: integrate UI rebuild + Plan A/B/C/D to develop, then promote prod

## Overview

`develop` and `main` are missing all recent product work: the ERP UI rebuild (P1–P7,
`feat/phase-d-facility-picker-and-stitch-wireframes`) and Plans A/B/C/D
(`feat/plan-a-ux-quickfixes`, `-b-datetime-pickers`, `-c-student-phone-login`,
`-d-nav-module-subtab-ia`). All 5 sit in OPEN PRs #27–31 (stacked: A/B/C/D → phase-d → main).
The live dev env (built from `develop`) therefore shows the OLD UI.

This plan consolidates that work **safely**: integrate onto `develop` first, verify on the live
dev environment, then promote to prod. The guiding constraint is **no implemented code may be lost
or broken** and prod is not touched until an explicit gate.

## Verified facts (from research, not assumption)

- **Integration is clean.** A throwaway cumulative trial-merge (phase-d→A→B→C→D onto `develop`)
  produced **zero code conflicts** and exactly **one docs conflict**:
  `plans/260703-0052-dev-prod-cicd-environments/plan.md` (resolve by union). The apparent
  "150–184 file overlap" is the identical shared phase-d base, not conflicting edits — the plan
  work is orthogonal.
- **No new DB migrations.** All branches carry the same 69 migrations as `develop`; the feature work
  adds none. Prod promote's `api-migrate` is a no-op → no schema/ordering risk.
- **CI/CD is live** (plan 260703-0052): `develop` push auto-deploys `cmcnew-dev`; `main` push
  deploys `cmcnew-prod`. A GitHub→Jenkins push webhook is now registered.
- Prod (`erp`/`hoc`) currently runs `84ff0d22`. Promoting = deploying the full UI rebuild to live prod.

## Phases

| Phase | Name | Status | Depends |
|-------|------|--------|---------|
| 1 | [Backup safety net](./phase-01-backup-safety-net.md) | Pending | none |
| 2 | [Integrate onto develop](./phase-02-integrate-onto-develop.md) | Pending | 1 |
| 3 | [Dev verification](./phase-03-dev-verification.md) | Pending | 2 |
| 4 | [Prod promote gate](./phase-04-prod-promote-gate.md) | Pending | 3 |
| 5 | [Cleanup and docs](./phase-05-cleanup-and-docs.md) | Pending | 4 |

## Acceptance Criteria

- [ ] Immutable backup tags exist for develop, main, phase-d, plan-a/b/c/d before any merge.
- [ ] Integration branch merges all 5 branches with only the 1 known docs conflict; `git diff`
      confirms every feature-branch file is represented (no code dropped).
- [ ] `develop` (after PR merge) contains CI/CD + phase-d + A/B/C/D; typecheck/lint/integration pass.
- [ ] Live dev env (`deverp`/`devlms`) shows the NEW UI (nav rail, datetime pickers, student phone
      login) and passes happy→edge functional checks + the E2E/persona suite.
- [ ] Push webhook confirmed live-triggering the develop build.
- [ ] Prod promote: `main` deploys, `erp`/`hoc` serve the new UI, health+smoke green, rollback tested/ready.
- [ ] No implemented code lost (feature-signature diff = 0 missing); PRs #27–31 closed with note; backup tags retained.

## Rollback posture (whole-plan)

- Any step is reversible from the Phase 1 backup tags (`git reset --hard <tag>` / redeploy a tag).
- Prod deploy does not switch traffic on a failed build (compose behavior); nginx has timestamped
  backups; Jenkins can rebuild the previous commit. Prod rollback = redeploy `backup/main-preintegration`.

## Red Team Review — Session 1 (2026-07-04)

Adversarial review (code-reviewer subagent) verified merge-safety claims against the repo. Verdict:
`DONE_WITH_CONCERNS`. Findings + resolutions:

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| C1 | Critical | Promote also lands CI/CD infra (Jenkinsfile/compose/nginx) onto `main`, not just app code | **Fixed** in phase-04: infra-diff review step + framed as first-class. **Verified** that infra is already-live and develop's tracked nginx == live nginx (byte-identical) → deploy infra-steps are idempotent no-ops; genuine change = app images. |
| H1 | High | Phase 2 no-loss check (`diff branch HEAD == 0`) is logically impossible (diff is symmetric) | **Fixed** phase-02: use `git merge-base --is-ancestor <branch> HEAD` (inclusion) + deletions-only review + CI/CD-not-reverted grep. |
| H2 | High | Rollback to `84ff0d22` re-runs the pre-split pipeline + pre-edge compose → could break live dev routing | **Fixed** phase-04: rollback = revert-merge on `main` (keeps post-split infra) + nginx-backup reload; never rebuild 84ff0d22. |
| H3 | High | Phase 4 relied on the new/unproven webhook with no fallback; no "merge=immediate deploy" warning | **Fixed** phase-04: API-trigger fallback; go-ahead captured BEFORE merge; webhook confirmed `events:[push]` (covers main). |
| M1 | Medium | Promote exposes Plan C's fixed default LMS credential to REAL families; dev can't test real-account back-compat | **Added** to phase-04 as a product-owner confirmation + prod-account resolvability check. Accepted product decision (0033), not a defect. |
| M2 | Medium | Live prod nginx may drift from tracked file → promote restart = surprise routing change | **Verified identical** (2026-07-04) + added as a re-check gate in phase-04. |
| M3 | Medium | Phase 3 E2E "should pass" asserted, not evidenced; develop build doesn't re-seed | **Fixed** phase-03: record actual pass/fail, confirm TEST_* creds + seed state. |
| LOW | Low | Lockfile-drift risk overstated (only Plan C adds a devDep) | **Downgraded** in phase-02. |

Also verified TRUE (don't re-litigate): 69 migrations identical (no schema); Plan C LMS token shape
preserved (live `cmc.lms` sessions survive); no new runtime env vars; sibling barrel edits
non-colliding; clean-merge durable (`merge-tree` found 0 code conflicts independent of `-X`).

## Implementation Summary — 2026-07-04 (executed, all 5 phases)

- **Phase 1:** 7 `backup/*-preintegration` tags pushed to origin (retained). Baselines recorded.
- **Phase 2:** `integ/feature-consolidation` merged phase-d→A→B→C→D onto develop; only the 1 expected
  docs conflict (`0052/plan.md`, resolved to develop's superset). No-loss proven: all 5 branches
  ancestors of HEAD; Plan C & D own-files 100% intact; A & B's one co-edit (`class-workspace.tsx`)
  merged coherently (B's pickers supersede A's TextInputs). CI/CD preserved. PR #35.
- **Phase 3:** merged to develop → **webhook auto-triggered the build (confirmed live)**. First build
  failed on ONE deterministic test-isolation failure (`receipt-batch-course-guard` asserted a
  courseId guard that commit `b1ec5a4` deliberately replaced with a facility guard — a **stale
  test**, not a product regression: code+test byte-identical to green develop). Fixed the stale test
  to the intended invariant (PR #36). Rebuild **green: 104/104 test files**, dev deployed
  `ee2bd9d`; functional login + SSO verified on deverp/devlms. Prod stayed `84ff0d22`.
- **Phase 4:** prod DB dump + nginx backup taken; nginx tracked==live (no-op) reconfirmed. PR #37
  develop→main → webhook auto-triggered main build #22 → **SUCCESS**. Prod = **`ba41351`** (new UI);
  `api-migrate` no-op; prod postgres/redis kept 33h uptime (data preserved); **dev stack undisturbed**;
  ci 200; prod SSO OK; 0 OOM. No rollback needed.
- **Phase 5:** PRs #27–31 closed with traceability; 7 merged branches deleted; backup tags retained.

**Outcome:** ERP UI rebuild + Plan A/B/C/D + dev/prod CI-CD are live on prod (`ba41351`) and dev
(`ee2bd9d`); no code lost; one stale test corrected; zero prod regression.

## Validation Log — Session 1 (2026-07-04)

Critical-questions interview after red-team fixes. Decisions:
- **M1 (LMS default credential):** ACCEPT — promote Plan C normally per decision 0033; Phase 4 still
  verifies prod student accounts resolve under phone-identity login.
- **C1 (infra bundling):** BUNDLE app + CI/CD infra in one develop→main promote (verified no-op:
  infra already live, tracked nginx == live nginx).
- **Execution scope:** user AUTHORIZED full autonomous execution of ALL 4 phases **including the prod
  promote (Phase 4)** — stop only on a real error/regression. This satisfies Phase 4's step-0 human
  go-ahead gate. Execute with backup + verify-each-step + rollback-ready; report at the prod boundary.

Verified-as-fact (previously open): live prod nginx == develop tracked (identical); webhook
`events:[push]` covers `main`.

## Dependencies

- Related (not blocking): `plans/260703-0052-dev-prod-cicd-environments/` (the CI/CD split this plan rides on; implemented).
- Prod-promote (Phase 4) should ideally follow the ops-hardening backup restore-drill
  (`plans/260702-1109-ops-hardening/`, operator-pending) — noted as a soft precondition.
