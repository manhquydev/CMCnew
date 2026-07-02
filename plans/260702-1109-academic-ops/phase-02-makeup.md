---
title: "P2 — Makeup sessions (buổi học bù)"
phase: 2
status: pending
risk: high
owns: [apps/api/src/routers/schedule.ts, apps/api/src/lib/exercise-open.ts]
---

# P2 — Makeup sessions

## Context
- Source: brainstorm §PLAN5.2. `isMakeup` is dormant: only read at `services/curriculum-recompute.ts:30` (`isMakeup: false` filter), never written true; no single-session create endpoint in `schedule.ts`.
- **C1 — exercise-gate leak (must fix here).** `exercise-open.ts` `openedUnitIdsFor` (:34-49) and `assertExerciseOpenForStudent` (:71-86) are the ONLY gate deciding whether a curriculum unit's exercises are visible/submittable. Neither filters `isMakeup`. Today they open a unit for the WHOLE batch as soon as ANY session mapped to that `curriculumUnitId` has ended — keyed on `(curriculumUnitId, batch active-enrollment, ended)`, not on who attended. So a makeup session taught out of order (e.g. for one absent student) would prematurely open that unit's exercises for every active batchmate. Callers: `exercise.ts:88` (what a student sees as opened), `submission.ts:131,177` (submission gate). The `curriculum-recompute.ts:30` filter is a DIFFERENT code path (grade recompute) and does not protect this gate.
- Anchors (verified): `scheduleRouter` `schedule.ts:14`; `detectConflicts` reuse sites `:201`, `:348` (imported from `@cmc/domain-academic` `:6`); `model ClassSession` `schema.prisma:324`; field `isMakeup Boolean @default(false)` `:337`; recompute exclusion filter `services/curriculum-recompute.ts:30`; exercise gate `exercise-open.ts:34-49,71-86`; `model Attendance` `@@unique([classSessionId, enrollmentId])` `schema.prisma:391`.

## Requirements
- New `schedule.createMakeupSession({ classBatchId, sessionDate, startTime, endTime, roomId?, teacherId?, curriculumUnitId? })`.
- Sets `isMakeup = true`, `status = planned`.
- Reuse `detectConflicts` (room/teacher clash) exactly as batch generation does — same `SessionLike` shape.
- Recompute exclusion already correct (`:30` filters `isMakeup:false`) → makeup rows never shift final grade. **Verify no other recompute/progress query forgets the filter.**
- Attendance roster works unchanged (Attendance keyed by `classSessionId` + `enrollmentId`; makeup session gets rows via existing `attendance.listBySession` `:9`).

### C1 fix — exercise-open.ts two-tier makeup gate (REQUIRED architecture, state explicitly)
The gate must implement a per-student, not class-wide, makeup rule:
- **Tier A — class-wide unit-open:** a session only counts toward "unit opened for the batch" when `isMakeup = false`. Add `isMakeup: false` to the `classSession.findMany` where-clause in BOTH `openedUnitIdsFor` (:34-49) and `assertExerciseOpenForStudent` (:71-86). This matches the existing `curriculum-recompute.ts:30` pattern and stops a makeup session opening units class-wide.
- **Tier B — per-student makeup override:** a student who ATTENDED a specific makeup session (has an `Attendance` row with `status` in `{present, late}` for a session where `isMakeup=true` and its `endTime` has passed) gets INDIVIDUAL early access to that makeup session's `curriculumUnitId` exercise — even before that student's regular class session for the unit. This is an attendance-keyed per-student check, distinct from the class-wide session-state check.
- Shape: after the Tier-A class query, run a second query per student — makeup sessions with a present/late Attendance row for that student's enrollments — and union their `curriculumUnitId`s into the opened set. `openedUnitIdsFor` (multi-student) must compute this per studentId; `assertExerciseOpenForStudent` (single student) checks the makeup-attendance override for `exercise.curriculumUnitId` when the Tier-A class check fails.
- Non-attendees of the makeup session see NO change — they still wait for their own scheduled regular session of that unit.

## Files
- Modify: `apps/api/src/routers/schedule.ts` (add mutation near existing conflict-checked generation `:201`/`:348`).
- Modify: `apps/api/src/lib/exercise-open.ts` (C1 two-tier gate: Tier-A `isMakeup:false` on both queries + Tier-B per-student makeup-attendance override). Run `gitnexus_impact({target:'openedUnitIdsFor'})` and `gitnexus_impact({target:'assertExerciseOpenForStudent'})` before editing — callers at `exercise.ts:88`, `submission.ts:131,177`.
- No schema change → **no migration**.
- Permission: add `schedule.createMakeupSession` (or reuse `schedule` write perm) — verify registry.

## Implementation steps
1. Add mutation guarded by appropriate `requirePermission`.
2. Validate batch open/running; build `SessionLike` for the new slot.
3. Call `detectConflicts` against existing sessions of same room/teacher/date → reject on clash (surface conflicting session).
4. Create ClassSession `isMakeup:true`.
5. Return created session id.
6. C1 Tier-A: add `isMakeup:false` to both `classSession.findMany` where-clauses in `exercise-open.ts`.
7. C1 Tier-B: add per-student makeup-attendance override (present/late Attendance row on an ended `isMakeup=true` session → open that session's `curriculumUnitId` for that student only).

## Tests / validation
- Int: makeup session created; `isMakeup=true`; excluded from `computeFinalGrade` recompute.
- Int: room/teacher conflict rejected.
- Int: attendance can be marked on makeup session and appears in `listBySession`.
- Grep guard: assert every recompute/progress query includes `isMakeup:false` (regression check).
- **C1 Tier-A regression:** a makeup session mapped to a not-yet-reached unit does NOT open that unit's exercise for a non-attendee batchmate (`assertExerciseOpenForStudent` → FORBIDDEN; unit absent from `openedUnitIdsFor`).
- **C1 Tier-B:** a student with a present/late Attendance row on that ended makeup session DOES get access to that unit's exercise before the class's regular session.

## Risks / rollback
- Risk (high→mitigated): makeup leaking into recompute → covered by existing `:30` filter; add test to lock it.
- Risk (low): conflict false-negative if `SessionLike` shape drifts → reuse exact builder from batch gen.
- Rollback: revert code; created makeup rows are ordinary sessions (deletable if needed).

## Blockers
- Depends on Plan 1 session shape. Independent of P1/P3 files.
