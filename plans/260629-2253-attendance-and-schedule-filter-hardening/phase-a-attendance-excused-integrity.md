# Phase A — Attendance "Có phép" Integrity (high-risk)

## Context Links

- `apps/admin/src/attendance-roster.tsx` — shared marker. `mark(enrollmentId, status, excused)` calls
  `attendance.mark` (L43-57). "Có phép" checkbox is `disabled={!cur?.status}` (L99) but stays checked when
  status changes from Absent to Present/Late → contradictory Present+excused.
- `apps/api/src/routers/attendance.ts` — `attendance.mark` mutation (server contract; the real gate).
- `packages/db/prisma/schema.prisma` — `Attendance.status` + `excused` (no new column expected).
- Evidence: `../reports/qc-c-260629-2119-edge-ux-report.md` Major-1. Backlog #7.

## The Problem

Excused ("Có phép") only makes sense for an absence. The UI lets Present/Late carry `excused=true`, and the
server `attendance.mark` accepts it, so contradictory rows can persist and flow into attendance→KPI/payroll.

## Requirements

- Server (source of truth): `attendance.mark` must NOT persist `excused=true` unless `status='absent'`.
  Decide (plan Open Q1): REJECT with a TRPCError (recommended — explicit contract) OR NORMALIZE (force
  excused=false). Confirm whether "Muộn" (late) may ever be excused (Open Q2) — default: Absent-only.
- UI: when status is set to present/late, force the excused checkbox off and keep it disabled; enable it only
  for Absent. Submitting still cannot send a bad combo.
- No schema/migration (validation rule only) — confirm.

## Implementation Steps (later build phase)

1. Read `attendance.mark` input + handler; run `gitnexus_impact` on `mark`/AttendanceRoster.
2. Add the excused-requires-absent rule to the mark input (zod `.refine`) or handler guard.
3. Update `AttendanceRoster.mark` so changing status to non-absent sends excused=false and the checkbox resets/disables.
4. Add a regression test: `attendance.mark` with status=present+excused=true is rejected (or normalized);
   absent+excused passes; existing attendance tests still green.

## Validation

- Unit/integration: bad combo rejected/normalized server-side; absent+excused OK; toggling status clears excused.
- UI: cannot check "Có phép" for Present/Late; switching to Present clears a prior excused.
- API + admin typecheck green; existing attendance tests pass.

## Risks / Rollback

- Risk: narrowing the contract breaks an existing caller that sent excused with non-absent. Mitigation: grep
  callers; the only UI caller is AttendanceRoster. Rollback: revert the refine + UI guard.
