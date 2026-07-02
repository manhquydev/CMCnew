---
title: "P1 — Enrollment transfer (chuyển lớp, history-preserving)"
phase: 1
status: pending
risk: high
owns: [apps/api/src/routers/enrollment.ts]
---

# P1 — Enrollment transfer

## Context
- Source: brainstorm §PLAN5.1. No `transfer` mutation exists; `EnrollmentStatus.transferred` is only read as a defensive guard (`attendance.ts:60`), never written. Drop+re-enroll would lose Attendance continuity (Attendance is keyed by `enrollmentId` via `@@unique([classSessionId, enrollmentId])`).
- **Design decision (verified, intentional — do NOT "fix"):** `FinalGrade` is NOT keyed by `enrollmentId`. It is keyed `@@unique([studentId, program, periodKey])` (`schema.prisma:905-925`). `computeFinalGrade` (`assessment.ts:229-238`) aggregates attendance rate by `where: { enrollment: { studentId } , session:{sessionDate: inTerm} }` — i.e. across ALL of a student's enrollments in the term, not one class. So after a mid-term transfer the final grade automatically BLENDS old-class + new-class attendance/grades within the term. This is the intended single-student-record behavior. Continuity works because FinalGrade was never per-enrollment — NOT because we "don't touch old rows". Do not add enrollment-scoping to `computeFinalGrade`.
- Anchors (verified): `enrollmentRouter` `apps/api/src/routers/enrollment.ts:9`; `enroll` mutation `:51`; lifecycle-transition + chatter pattern `:85-98`; `model Enrollment` `schema.prisma:352`; enum value `transferred` `schema.prisma:74`; `computeFinalGrade` attendance blend `assessment.ts:229-238`; exercise gate `exercise-open.ts:34-49,71-86`.

## Requirements
- New `enrollment.transfer({ enrollmentId, targetClassBatchId, effectiveDate?, reason? })`.
- Old enrollment → status `transferred`, `archivedAt` unchanged (keep readable). New enrollment created for **same** `studentId` in target batch, status `active`.
- Preserve Attendance history: do NOT touch existing Attendance rows on the old enrollment (they stay keyed to old enrollmentId — visible as prior-class record). FinalGrade is student-keyed (see Context) so it needs no special handling — it blends automatically.
- Chatter/audit: timeline entry on student (mirror `:97`) recording `old batch → new batch`, plus `changes` diff.
- LMS continuity: new enrollment surfaces via `enrollment.mine` (`:18`, lmsProcedure) with no gap.
- **Old-class exercise access is CUT at transfer (accepted, KISS — operator FINAL).** Flipping old enrollment to `transferred` means `exercise-open.ts` (`openedUnitIdsFor`:34-49, `assertExerciseOpenForStudent`:71-86, both scoped `enrollments.some{status:'active'}`) will 403 (`Bài tập chưa mở cho học sinh này`) any in-flight, not-yet-submitted old-class exercise the moment transfer lands. This is intentional: the student now belongs to the new class. Parent-facing UX: old sessions STILL show in the timeline (`schedule.ts sessionsForStudent` filters `archivedAt:null`, not status) — that is a historical record, not an access grant; no work needed. P1 does NOT modify `exercise-open.ts`.
- Reuse capacity soft-warning from `enroll` (`enrollment.ts:126`) — warn, never block (D-KISS).

## Files
- Modify: `apps/api/src/routers/enrollment.ts` (add `transfer` between `:51` and `:132`).
- No schema change (enum + columns already present) → **no migration**.
- Permission: reuse/add `enrollment.transfer` in permission registry (`packages/auth/src/permissions.ts`) — verify key naming before adding.

## Implementation steps
1. Add `transfer` mutation guarded by `requirePermission('enrollment','transfer')`.
2. In one `withRls` tx: load old enrollment (assert status `active`/`reserved`, else conflict error); guard already-`transferred`/`withdrawn`.
3. Flip old → `transferred`.
4. Create new enrollment (same `studentId`, `targetClassBatchId`, status `active`, `opportunityId` copied, `createdByReceiptId` NULL).
5. Capacity soft-warn on target batch (return warning flag, do not throw).
6. Write chatter timeline entry (kind consistent with existing enrollment log).
7. Return `{ oldEnrollmentId, newEnrollmentId, warning? }`.

## Tests / validation
- Int: transfer keeps old Attendance rows intact; new enrollment active; old = transferred.
- Int (design assertion): after a mid-term transfer, `computeFinalGrade` attendance rate blends BOTH enrollments' in-term sessions (studentId-scoped) — assert the rate reflects old+new sessions, not just the new class.
- Int: `attendance.mark` on transferred enrollment rejected (existing guard `:60`).
- Int (M2 accepted behavior): an unsubmitted old-class exercise 403s via `assertExerciseOpenForStudent` after transfer; assert this is the expected FORBIDDEN, and that old sessions still list in `sessionsForStudent`.
- Int: over-capacity target returns warning, still succeeds.
- Manual: parent sees both old (past) and new (current) class in LMS.

## Risks / rollback
- Risk (med): double-active if tx not atomic → single `withRls` tx, assert old status before flip.
- Risk (low): orphan new enrollment if target batch closed → validate `ClassStatus` open/running.
- Rollback: no schema delta; revert code. Manual data fix = flip new→archived, old→active (documented, rare).

## Blockers
- Depends on Plan 1 `260702-0929` session/exercise shape (stable). Must land before P5 (P5 reads lifecycle on same student path).
