---
title: "P2 — Makeup sessions (buổi học bù)"
phase: 2
status: pending
risk: high
owns: [apps/api/src/routers/schedule.ts]
---

# P2 — Makeup sessions

## Context
- Source: brainstorm §PLAN5.2. `isMakeup` is dormant: only read at `curriculum-recompute.ts:30` (`isMakeup: false` filter), never written true; no single-session create endpoint in `schedule.ts`.
- Anchors (verified): `scheduleRouter` `schedule.ts:14`; `detectConflicts` reuse sites `:201`, `:348` (imported from `@cmc/domain-academic` `:6`); `model ClassSession` `schema.prisma:324`; field `isMakeup Boolean @default(false)` `:337`; recompute exclusion filter `curriculum-recompute.ts:30`.

## Requirements
- New `schedule.createMakeupSession({ classBatchId, sessionDate, startTime, endTime, roomId?, teacherId?, curriculumUnitId? })`.
- Sets `isMakeup = true`, `status = planned`.
- Reuse `detectConflicts` (room/teacher clash) exactly as batch generation does — same `SessionLike` shape.
- Recompute exclusion already correct (`:30` filters `isMakeup:false`) → makeup rows never shift final grade. **Verify no other recompute/progress query forgets the filter.**
- Attendance roster works unchanged (Attendance keyed by `classSessionId` + `enrollmentId`; makeup session gets rows via existing `attendance.listBySession` `:9`).

## Files
- Modify: `apps/api/src/routers/schedule.ts` (add mutation near existing conflict-checked generation `:201`/`:348`).
- No schema change → **no migration**.
- Permission: add `schedule.createMakeupSession` (or reuse `schedule` write perm) — verify registry.

## Implementation steps
1. Add mutation guarded by appropriate `requirePermission`.
2. Validate batch open/running; build `SessionLike` for the new slot.
3. Call `detectConflicts` against existing sessions of same room/teacher/date → reject on clash (surface conflicting session).
4. Create ClassSession `isMakeup:true`.
5. Return created session id.

## Tests / validation
- Int: makeup session created; `isMakeup=true`; excluded from `computeFinalGrade` recompute.
- Int: room/teacher conflict rejected.
- Int: attendance can be marked on makeup session and appears in `listBySession`.
- Grep guard: assert every recompute/progress query includes `isMakeup:false` (regression check).

## Risks / rollback
- Risk (high→mitigated): makeup leaking into recompute → covered by existing `:30` filter; add test to lock it.
- Risk (low): conflict false-negative if `SessionLike` shape drifts → reuse exact builder from batch gen.
- Rollback: revert code; created makeup rows are ordinary sessions (deletable if needed).

## Blockers
- Depends on Plan 1 session shape. Independent of P1/P3 files.
