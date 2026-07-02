---
title: "ERP/LMS seam fixes: exercise auto-open + HR director split + cleanup"
description: "Restructure Exercise as curriculum asset with query-time auto-open, re-own HR/payroll to the two directors with domain scoping, and clear dead UI/DB seams in one high-risk round."
status: implemented-validation-partial
priority: P1
effort: 3-4d
branch: develop
tags: [lms, exercise, curriculum, payroll, rbac, cleanup]
created: 2026-07-02
---

# ERP/LMS Seam Fixes

Source of truth: `plans/reports/brainstorm-260702-0929-lms-erp-seam-fixes-report.md` (D1–D6 FINAL, operator-approved — do not re-litigate).

## Lane & Intake (HIGH-RISK — FEATURE_INTAKE hard gates)

Hard gates tripped: **Authorization** (exercise write narrowed, payroll re-owned), **Data model** (Exercise restructure + drop GradingThreshold), **Existing behavior** (giao_vien loses exercise perms, RLS change). ≥4 risk flags → high-risk lane.

Required durable artifacts (checkpoints, NOT code):
- High-risk story folder from `docs/templates/high-risk-story/` (execplan.md, overview.md, design.md, validation.md).
- **Decision A** — Exercise as global curriculum asset (extends decision 0021 no-RLS invariant to `exercise`).
- **Decision B** — HR/payroll ownership moves to the two directors with domain scoping (partial reversal of RBAC Phương án C which kept hr/ke_toan ownership).
- Harness checkpoints: `harness-cli intake` (record row) → `harness-cli story add`/`story update` (per workstream) → `harness-cli decision add` (A, B) → `harness-cli trace` at each phase close. ck runs the work; harness proves it.

## Phases

| # | Phase | Status | Link |
|---|-------|--------|------|
| P1 | Data model: Exercise restructure + drop GradingThreshold + archive legacy + seed | implemented | [phase-01-data-model.md](phase-01-data-model.md) |
| P2 | Exercise API: TZ-safe auto-open listForPrincipal + director-only per-unit upsert + perms | implemented | [phase-02-exercise-api.md](phase-02-exercise-api.md) |
| P3 | ERP UI: per-unit exercise manager + schedule-detail read-only indicator | implemented | [phase-03-erp-ui.md](phase-03-erp-ui.md) |
| P4 | LMS UI: climb/student adapt to reshaped listForPrincipal + "opens after session" | implemented | [phase-04-lms-ui.md](phase-04-lms-ui.md) |
| P5 | HR split: perms re-own + domain scoping + profileUpsert/rateCreate UI + nav fix + Decision B | implemented | [phase-05-hr-split.md](phase-05-hr-split.md) |
| P6 | Cleanup: classBatch.update UI + de-cast 5 panels + delete loginParent + /showcase DEV gate | implemented | [phase-06-cleanup.md](phase-06-cleanup.md) |
| P7 | Validation: parity snapshot + int tests + e2e teacher-nav + migration 0-drift on prod-mirror | partial | [phase-07-validation.md](phase-07-validation.md) |

## Dependency graph

```
P1 (data model) ──┬─> P2 (exercise API) ──┬─> P3 (ERP UI)
                  │                        └─> P4 (LMS UI)
                  └─> P5 (HR split)  [independent of P2, shares permissions.ts — serialize the edit]
P6 (cleanup)  [mostly independent; classBatch.update UI + de-cast; touches permissions/schema? no]
P7 (validation) depends on ALL (P1–P6)
```

File-ownership note: P2 and P5 BOTH edit `packages/auth/src/permissions.ts` and its snapshot → **must not run in parallel**; serialize (P2 exercise module first, then P5 payroll module) or land in one branch with sequential commits.

## Global success criteria (from brainstorm §6)

1. Director uploads B2 for UCREA-L1 → every class teaching UCREA-L1 sees B2 auto-open right after their own B2 session ends; not before.
2. Teachers can no longer create/publish exercises; the 2 dead buttons are gone, replaced by per-session status indicator.
3. Training director creates profile+rate for a teacher from UI; business director for sale/ops; neither crosses domains (test-enforced).
4. `pnpm typecheck` clean, no `as any` around tRPC client; parity + int + e2e green; migration chain replays 0-drift from zero on prod-mirror.

## Migration safety (lesson: journal 260701-2254 work-shift chain fix)

Every DB-touching phase (P1) must produce migrations that replay from an empty DB with 0 drift. Verify with `prisma migrate reset` + `prisma migrate diff` per `docs/operate-and-test-guide.md`. Rollback notes live in each phase file.

## Validation Summary

Implementation pass 2026-07-02:
- Passed: `pnpm --filter @cmc/db generate`
- Passed: `pnpm --filter @cmc/db exec prisma validate`
- Passed: `pnpm --filter @cmc/api typecheck`
- Passed: `pnpm --filter @cmc/admin typecheck`
- Passed: `pnpm --filter @cmc/lms typecheck`
- Passed: `pnpm --filter @cmc/lms build` (Vite chunk-size warning only)
- Passed: `rg "showcase|Trải nghiệm UI mới|ShowcaseView" apps/lms/dist` returns no production asset hits.
- Passed: `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` (23 tests).
- Blocked by local env: guardian integration test cannot reach Postgres at `localhost:5433`.
- Not run: migration reset/diff and browser e2e; local database unavailable.

**Validated:** 2026-07-02 · **Questions asked:** 3 (+3 resolved pre-validate: HR view director-any, loginParent full removal, student-account birth confirmed no-change)

### Confirmed Decisions
- **Cardinality**: unique per `(curriculumUnitId, type)` — one homework AND optionally one test per REVIEW unit (composite unique). Final-grade hw/test split in `assessment.ts:219-222` stays valid. Director upload UI = per-unit rows, homework slot + test slot (where applicable). Multi-of-same-type per unit = YAGNI.
- **Deadline**: NO dueAt — exercises open after the session and stay open (LMS = practice platform, ages 3-11). Drop `dueAt` from Exercise in P1; NO due field in P2 upsert input or P3 form; remove dueAt renders in P4.
- **Teacher access**: giao_vien KEEPS read (`listByClass`-equivalent) + grading/star flows unchanged; only exercise content writes move to the 2 directors. `grading.tsx` create/publish UI is REMOVED (P3), read+grade path kept.
- **Legacy data**: HARD-DELETE legacy exercises + submissions in the P1 migration (D4: prod has no real submissions) — enables plain composite unique + NOT NULL, no partial index, 0-drift preserved.
- **Payroll self-write**: BLOCKED — a director cannot profileUpsert/rateCreate their OWN record; the other director or super_admin must (P5 guard + Decision B).
- **Auto-open timing**: exercise opens after the FIRST non-cancelled session of its unit ends (end ≤ now ICT); cancelled sessions excluded (P2).

## Red-team revision log (2026-07-02)
Red-team report `reports/from-code-reviewer-to-planner-red-team-plan-review-260702-1007.md` (verdict FIX-FIRST) findings → fixes:
- C1 → P1: migration must `DROP POLICY exercise_isolation` AND `ALTER TABLE exercise DISABLE ROW LEVEL SECURITY` (app is non-owner `cmc_app` → policy-drop alone = default-deny outage); never edit historical enable-loop.
- C2 → P2: submission `draftSave`/`submit` re-check unit-opened + derive `facilityId` from student enrollment/batch (exercise column dropped); int tests cross-class + before-open denied.
- C3 → P1: hard-delete legacy rows; migration order add col → delete → composite unique + NOT NULL → disable RLS/drop policy → drop columns → drop grading_threshold.
- C4 → P3: strip `grading.tsx` CreateExerciseModal + create/publish mutations (`:81,:529,:546`); keep read+grade.
- M1 → P7: enumerate 8 old-shape Exercise test files + rewrite lifecycle-e2e (deleted procs) + security-invariants #1 (removed-RLS semantic).
- M2 → P1: composite unique per unit+type; seed maps hw+test per unit (not per batch); assessment split unchanged.
- M3 → P2/P3/P4: purge due everywhere; P4 removes `student-view.tsx:216,384` dueAt renders + "Hạn nộp" column.
- M4 → P2: openedUnitIds excludes cancelled sessions (mirror `schedule.ts:441`); first-session-end rule pinned.
- M5 → P5: block self-target on profileUpsert/rateCreate + matrix test + Decision B text.
- M6 → P6: cast inventory = 15 across 6 files incl. `checkin-panel.tsx` (7).
- Decision A record must state `/files/exercise/:ref` loosens from enrolled-classes to any-authenticated-principal (no PII in worksheets).
