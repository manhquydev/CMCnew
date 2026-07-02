# Phase 2 (Makeup sessions + C1 exercise-gate fix) — completion report

## Status: DONE

## Impact analysis method
GitNexus MCP tools were not available in this session (no `gitnexus_*` tool surface exposed).
Used a manual grep-based caller analysis instead, documented here:
- `grep -rn "openedUnitIdsFor|assertExerciseOpenForStudent" apps/api/src` → confirmed the only
  callers are `apps/api/src/routers/exercise.ts:88` (`openedUnitIdsFor`) and
  `apps/api/src/routers/submission.ts:154,246` (`assertExerciseOpenForStudent`), matching the
  plan's stated call sites exactly. No other call sites exist.
- Read `curriculum-recompute.ts:30` to confirm the existing `isMakeup: false` filter convention
  before mirroring it in `exercise-open.ts`.
- Read `schedule.ts` in full for `detectConflicts`/`SessionLike` reuse and the `generateSessions`
  conflict-check pattern before writing `createMakeupSession`.

## Files modified
- `apps/api/src/lib/exercise-open.ts` — C1 two-tier gate fix.
  - `openedUnitIdsFor`: added `isMakeup: false` to the Tier-A `classSession.findMany` where-clause;
    added a new `makeupOverrideUnitIdsFor` helper (Tier-B, per-student, attendance-keyed) whose
    result is unioned into the opened set.
  - `assertExerciseOpenForStudent`: added `isMakeup: false` to the Tier-A where-clause; when Tier-A
    finds no opened session, falls through to a Tier-B check (`Attendance` with
    `status in {present, late}` on an ended `isMakeup: true` session mapped to the exercise's unit).
- `apps/api/src/routers/schedule.ts` — new `createMakeupSession` mutation (single-session create,
  `isMakeup: true`, `status: 'planned'`), reusing `detectConflicts`/`SessionLike` exactly as
  `generateSessions` does, plus `assertSlotRefsInFacility` and a P2002→CONFLICT catch for the
  `(classBatchId, sessionDate, startTime)` unique constraint.
- `packages/auth/src/permissions.ts` — added `schedule.createMakeupSession: ['giam_doc_dao_tao']`,
  matching the existing role for all other `schedule.*` write actions.
- `apps/api/test/fixtures/permission-snapshot.json` — added the new permission entry (required by
  `permission-parity.test.ts`).
- `apps/api/test/schedule-makeup-session.int.test.ts` (new) — 7 integration tests, real dev DB, no
  mocks.

## Tasks completed
- [x] `schedule.createMakeupSession({ classBatchId, sessionDate, startTime, endTime, roomId?, teacherId?, curriculumUnitId? })`
- [x] `isMakeup = true`, `status = planned` on create
- [x] `detectConflicts` reuse (room/teacher clash rejection), same `SessionLike` shape as `generateSessions`
- [x] C1 Tier-A: `isMakeup: false` added to both `classSession.findMany` where-clauses
- [x] C1 Tier-B: per-student makeup-attendance override (present/late on an ended `isMakeup=true` session → individual early access to that session's unit)
- [x] Permission registry entry + snapshot sync

## Tests status
- Type check: **pass** (`pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/auth typecheck` — both clean)
- New integration tests (`apps/api/test/schedule-makeup-session.int.test.ts`, real dev DB):
  - (a) makeup session created `isMakeup=true`, excluded from `recomputeCurriculumMapping` — **pass**
  - (b) room/teacher conflict rejected (`CONFLICT`) — **pass**
  - (c) attendance markable on makeup session, appears in `listBySession` — **pass**
  - (d) **C1 Tier-A regression**: non-attendee batchmate gets `FORBIDDEN` on `submission.save`, unit
    absent from `exercise.listForPrincipal` — **pass**. Verified red-before-fix: stashed only
    `exercise-open.ts`, reran the suite, confirmed test (d) failed (`expected true to be false` —
    the leaky pre-fix gate opened the unit class-wide), then restored the fix (`git stash pop`) and
    reran — all 5 tests green again.
  - (e) **C1 Tier-B**: attendee student gets early access via both `exercise.listForPrincipal` and
    `submission.save` — **pass**
- Regression sweep on adjacent suites (`lms-security-invariants`, `submission-open-gate-forbidden-midedit`,
  `submission-version-conflict`, `submission-guardian-layer`, `lms-full-lifecycle-e2e`, `schedule-add-slot`,
  `schedule-generate-curriculum-map`, `schedule-edit-slot`) — **all pass** (67/67 excluding the
  pre-existing finance-ops permission-snapshot gap below).
- `permission-parity.test.ts`: **pass for this phase's entry.** One pre-existing failure remains —
  `finance.refundCreate`/`finance.refundList` are absent from the snapshot. These are NOT mine;
  they belong to the parallel Plan 4 (finance-ops) phase's in-flight, uncommitted work
  (`apps/api/src/routers/finance.ts` was modified outside this task's file-ownership scope). Verified
  by running `-t "no silent additions"` in isolation both before and after my snapshot edit: my
  `schedule.createMakeupSession` entry cleared; the finance entries were already failing
  independent of my change. Left untouched — out of file-ownership scope for this phase.

## Issues encountered
None blocking. No schema migration needed (confirmed `isMakeup` column pre-existed). No file
ownership conflicts.

## Next steps
- Plan 4 (finance-ops) owner should sync `permission-snapshot.json` for `finance.refundCreate`/
  `finance.refundList` when that phase lands (unrelated to this phase).
- Not committed per instructions — ready for orchestrator review/commit.

Status: DONE
Summary: createMakeupSession mutation + C1 two-tier exercise-gate fix implemented and tested against the real dev DB; typecheck clean; C1 regression test verified red-before-fix/green-after-fix.
Concerns/Blockers: None. One unrelated pre-existing permission-snapshot gap (finance.refundCreate/refundList) belongs to the parallel finance-ops phase, not this one — left untouched.
