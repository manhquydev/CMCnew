# Curriculum Framework Hard-Code + 1-Click Class Creation Shipped

**Date**: 2026-07-02 00:57
**Severity**: High (high-risk lane — data model + tRPC public contract + multi-domain)
**Component**: DB schema/seed, `@cmc/domain-academic`, API routers (curriculum/course/schedule/class-batch/audit), auth permissions, Admin class workspace, LMS student/parent
**Status**: Resolved (implemented on `develop`, not yet committed)

## What Happened

Shipped the full curriculum-framework feature from plan `260701-2246`: hard-code the CMC curriculum
(UCREA L1–L3, Bright I.G J/T/C/W/Q/U) into a `CurriculumUnit` table, seed it idempotently from CSV,
allow **1-click multi-slot class creation** against a hard-coded framework, map every generated
`ClassSession` to its curriculum unit, add slot/class edit mutations with full timeline logging, and
surface curriculum content per session in the LMS for students and parents.

Six phases, TDD, executed in dependency order (P1→P2→P3; P4 after P1; P5 after P3+P4; P6 last).
9 new test files, 38 curriculum-feature integration/unit tests green, plus full regression across the
schedule / class-batch / audit / LMS / permission-parity suites with zero regressions.

## The Brutal Truth

Two things fought back.

**Migration drift on a live dev DB.** `prisma migrate dev` refused to create the migration because two
*unrelated* prior migrations (`sales_ops_foundations`, `work_shift_rls`) were "modified after applied" —
it wanted to reset the whole dev database. Resetting would have wiped an hour-old working DB. Worked
around it non-destructively: generated the additive SQL with `prisma migrate diff --from-schema-datasource`
(live DB) `--to-schema-datamodel`, hand-placed it as `20260701230000_curriculum_unit`, applied via
`prisma db execute --url DIRECT_URL` (so `cmc` owns the table and default privileges flow to `cmc_app`),
then `migrate resolve --applied`. The pre-existing drift is still there for the team/CI to reconcile —
flagged, not silently fixed.

**The offset-mapping trap (red-team #1).** The naive "append new sessions, assign next units" approach
breaks the instant someone adds a weekly slot at an *earlier* weekday — every previously-mapped session
is now chronologically out of order. The fix is to **recompute the entire batch's unit mapping on every
generate/edit**, sorted by `(sessionDate, startTime)`, excluding cancelled/makeup. The pure
`assignUnitsToSessions` helper made this deterministic and testable; the ordering-hazard test (add a
Tuesday slot to a Friday-only batch, regenerate, assert the old Friday sessions moved to unit #2) is the
one that proves it. Cost: recompute is O(sessions) writes per generate — fine at ~48-60/batch, noted for
future `updateMany` batching if classes ever get huge.

## Technical Details

- **Schema**: `CurriculumUnit` (global, no `facility_id`, **no RLS** — mirrors `course`, decision 0021),
  `UnitType` enum, `Course.levelCode` + `units`, `ClassSession.curriculumUnitId` (SetNull). Additive.
- **Seed**: quote-aware CSV parser (RFC-4180 state machine — the data has embedded commas in quotes like
  `"Sách: Gum, Gum, Gummy"` and literal `||` separators). Course-per-level upsert → 9 courses, 60 units,
  240 sessions. `seed-demo` rebinds the demo batch to `UCREA-L1` and soft-archives legacy generic courses
  so the wizard shows one course family. Script `pnpm --filter @cmc/db seed:curriculum`.
- **API**: `curriculum.listByCourse` (read-only, protectedProcedure); `course.list` +levelCode/unitCount/
  totalSessions (grouped query, no N+1); `generateSessions` whole-batch recompute + aggregate log;
  `classBatch.create` accepts `slots[]` (normalizes legacy `initialSlot`, rejects duplicate day/time — the
  `skipDuplicates` silent-drop trap, red-team #10); `classBatch.update` with primitive-date `diffChanges`
  (raw Date objects are never `===`, would false-positive every diff); `schedule.editSlot`
  (batch-scoped `applyToFuture`, dual conflict check room/teacher **and** unique-key to avoid raw P2002,
  `getUTCDay` alignment, curriculum recompute on reorder) + `removeSlot` (soft-archive, sessions kept);
  `audit.timeline` now resolves `actorName`; LMS `schedule.sessionsForStudent` (lmsProcedure,
  ownership-scoped, null-safe curriculum join).
- **Permissions**: `classBatch.update`, `schedule.editSlot`, `schedule.removeSlot` → `['giam_doc_dao_tao']`,
  with matching `permission-snapshot.json` entries (parity test stays green).
- **UI**: `CreateClassModal` multi-slot wizard + read-only curriculum preview; `ScheduleTab` slot edit/remove
  (permission-gated via `can()`); `Chatter` renders actor name (class "Nhật ký" tab already mounted);
  new `CurriculumSessionsTab` added to both student and parent LMS shells.

## Verification

- 9 test files / 38 tests green (harness story `CURR-FRAMEWORK` verified pass).
- Typecheck clean: api, db, domain-academic, auth, admin. New code adds no lint/type errors.
- Code review (subagent): DONE_WITH_CONCERNS — all 7 acceptance criteria met, tenancy/correctness/contracts
  clean, no Critical/High. Low notes: recompute remap semantics (accepted design, documented in operate
  guide), write-loop perf (deferred, YAGNI), `curriculum_unit` app-writable (invariant documented in 0021).

## Known Pre-Existing (not introduced here)

- Dev-DB migration drift on two unrelated migrations (team/CI reconcile).
- `apps/lms` typecheck + `apps/lms`/`packages/ui` lint have pre-existing errors (Mantine `SimpleGrid gap`,
  unused imports in `showcase-view`/`leaderboard`/`login-gate`/`student-view` IconTrophy) in files this
  work never touched. CI typecheck/lint is not currently gating.

## Harness

Intake #51 (Spec slice, high-risk), story `CURR-FRAMEWORK` (verified), decision `0021`
(curriculum-unit-global-no-rls), trace recorded.
