---
title: "P1 — Enrollment transfer (chuyển lớp, history-preserving)"
phase: 1
status: pending
risk: high
owns: [apps/api/src/routers/enrollment.ts]
---

# P1 — Enrollment transfer

## Context
- Source: brainstorm §PLAN5.1. No `transfer` mutation exists; `EnrollmentStatus.transferred` is only read as a defensive guard (`attendance.ts:60`), never written. Drop+re-enroll loses attendance/grade continuity (both keyed by `enrollmentId`).
- Anchors (verified): `enrollmentRouter` `apps/api/src/routers/enrollment.ts:9`; `enroll` mutation `:51`; lifecycle-transition + chatter pattern `:85-98`; `model Enrollment` `schema.prisma:352`; enum value `transferred` `schema.prisma:74`.

## Requirements
- New `enrollment.transfer({ enrollmentId, targetClassBatchId, effectiveDate?, reason? })`.
- Old enrollment → status `transferred`, `archivedAt` unchanged (keep readable). New enrollment created for **same** `studentId` in target batch, status `active`.
- Preserve history: do NOT touch existing Attendance/FinalGrade rows on the old enrollment (they stay keyed to old id — visible as prior-class record).
- Chatter/audit: timeline entry on student (mirror `:97`) recording `old batch → new batch`, plus `changes` diff.
- LMS continuity: new enrollment surfaces via `enrollment.mine` (`:18`, lmsProcedure) with no gap.
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
- Int: transfer keeps old Attendance/FinalGrade rows intact; new enrollment active; old = transferred.
- Int: `attendance.mark` on transferred enrollment rejected (existing guard `:60`).
- Int: over-capacity target returns warning, still succeeds.
- Manual: parent sees both old (past) and new (current) class in LMS.

## Risks / rollback
- Risk (med): double-active if tx not atomic → single `withRls` tx, assert old status before flip.
- Risk (low): orphan new enrollment if target batch closed → validate `ClassStatus` open/running.
- Rollback: no schema delta; revert code. Manual data fix = flip new→archived, old→active (documented, rare).

## Blockers
- Depends on Plan 1 `260702-0929` session/exercise shape (stable). Must land before P5 (P5 reads lifecycle on same student path).
