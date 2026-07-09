# Phase 3 — Add existing student to a class (teacherLite.enrollExistingStudent, TDD-first)

- **Date:** 2026-07-09 · **Priority:** P1 · **Status:** pending · **Risk:** Medium · **Effort:** ~4h
- **Item:** #3 — pick an existing student, enroll directly into a class (no receipt workflow), block dup, keep RLS+audit.
- **Context:** brainstorm items 3, 6; decision 0040 (teacherLite.* bypass namespace).

## Key insights (verified)

- **Existing reference impl**: `enrollment.enroll` (**enrollment.ts:51-129**) already enrolls an
  existing student, blocks dup (`findFirst` archivedAt:null → CONFLICT, enrollment.ts:66-72), flips
  lifecycle→active with audit, notifies directors, computes overCapacity. BUT its permission is
  `enrollment.enroll: ['sale','giam_doc_kinh_doanh']` (**permissions.ts:143**) — missing giam_doc_dao_tao,
  and coupled to CRM `opportunityId` + staff-notif. See plan.md unresolved-Q1 (build-new chosen).
- **Unique constraint**: `Enrollment @@unique([classBatchId, studentId])` (**schema.prisma:396**). Note:
  the unique is (classBatchId, studentId) with NO archivedAt — so a soft-archived prior enrollment
  (`archivedAt != null`) still occupies the unique key → a naive `create` throws P2002. Direct-provisioning
  handles this by treating an archived existing enrollment as CONFLICT (teacher-lite-direct-provisioning.ts:182-189).
  Mirror that: check `findUnique({ classBatchId_studentId })`; if found → CONFLICT (whether archived or active).
- **teacherLite pattern**: router `teacher-lite.ts:21-40` wires `requirePermission('teacherLite', X)` →
  service fn `(session, input)`. Services use `withRls({ facilityIds, isSuperAdmin }, tx => …)` +
  `assertFacilityAccess` + `logEvent` (see teacher-lite-class-workflows.ts:59-63, 168-249).
- **Permission registry** for teacherLite: permissions.ts:85-94 (createFamilyStudentAndEnroll, createClass,
  cancelClass, cancelSession, studentArchive, overviewStats). Add `enrollExistingStudent` here.
- **UI host**: `apps/admin/src/teacher-lite-class-control-panel.tsx` (class hub; imports trpc, useSession,
  can, Modal, Select). Roster shown via `enrollment.listByBatch` (enrollment.ts:39-49). Student picker
  source: `student.list` (student.ts:11) exists.

## Requirements

New mutation `teacherLite.enrollExistingStudent({ facilityId, classBatchId, studentId })`:
- Actor must be a teacher-lite director (giam_doc_kinh_doanh / giam_doc_dao_tao / super_admin).
- Validate batch exists, not archived, belongs to facilityId (mirror direct-provisioning:73-82).
- Validate student exists + belongs to facilityId (RLS already scopes; assert facility for defense).
- Block duplicate: any existing enrollment on (classBatchId, studentId) → CONFLICT (active or archived).
- Create Enrollment(status:'active'); flip student.lifecycle→active if not (with audit); logEvent 'created'.
- Return `{ enrollment, overCapacity, capacity, enrolledCount }` (soft capacity warning, non-blocking —
  matches enrollment.enroll:126). NO CRM opportunity, NO email. (Keep it lean per decision 0040.)

UI: in class-control-panel, add "Thêm học viên có sẵn" action → Modal with student Select (search by
name/code) + confirm → call mutation → refetch roster + toast; surface overCapacity warning.

## TDD-first — write BEFORE implementation

### `apps/api/test/teacher-lite-enroll-existing.int.test.ts` (new)

Pattern: `staffCaller`, `withRls(SUPER)`, `uniq`, `dbReachable` guard, teardown (mirror
attendance-report-markall.int.test.ts setup + teacher-lite CRUD tests if present).

Fixtures: 1 facility, director (giam_doc_dao_tao), 1 course, 1 batch (capacity 1), 2 students S1/S2.

- **(a) enroll succeeds** — director enrolls S1 → returns enrollment(active); row exists; student
  lifecycle active; audit event logged (assert via `tx.eventLog`/logEvent table if convention allows).
- **(b) duplicate active rejected** — enroll S1 again → CONFLICT.
- **(c) duplicate archived rejected** — archive S1's enrollment (`archivedAt` set), enroll S1 again →
  CONFLICT (unique key still occupied — proves we don't P2002/500).
- **(d) overCapacity soft-warn** — enroll S2 (capacity=1, already 1 active) → succeeds with
  `overCapacity: true` (non-blocking).
- **(e) facility guard** — director without facilityId access (or batch in other facility) → FORBIDDEN.
- (optional) teacher (giao_vien) caller → permission-denied (not in the permission list).

## Implementation steps

1. New service `apps/api/src/services/teacher-lite-enroll-existing.ts` (~70 lines):
   - `export const enrollExistingStudentInput = z.object({ facilityId: z.number().int().positive(), classBatchId: z.string().uuid(), studentId: z.string().uuid() })`.
   - `export async function teacherLiteEnrollExistingStudent(session, input)` — withRls,
     assertFacilityAccess, batch+facility validation, dup check via
     `tx.enrollment.findUnique({ where: { classBatchId_studentId: { classBatchId, studentId } } })`,
     create + lifecycle flip + logEvent, overCapacity calc. Wrap P2002 → CONFLICT (defensive, mirror
     class-workflows isPrismaUniqueConflict:65-67).
2. `apps/api/src/routers/teacher-lite.ts`: add
   `enrollExistingStudent: requirePermission('teacherLite','enrollExistingStudent').input(enrollExistingStudentInput).mutation(({ctx,input}) => teacherLiteEnrollExistingStudent(ctx.session, input))`.
3. `packages/auth/src/permissions.ts:85-94`: add
   `enrollExistingStudent: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao']` to the `teacherLite` block.
4. **GitNexus impact** before editing router/permissions: `gitnexus_impact({target:'teacherLiteRouter'})`
   is a new leaf; permissions.ts is config (low risk). Run `gitnexus_detect_changes()` pre-commit to
   confirm only expected symbols changed.
5. UI `teacher-lite-class-control-panel.tsx`: add Modal + student Select (data from `student.list`,
   filter to facility) + `trpc.teacherLite.enrollExistingStudent.mutate`; on success `onChanged?.()` +
   refetch roster; show `notifySuccess`/overCapacity `notifyInfo`. Gate the button with
   `can(me.roles, me.isSuperAdmin, 'teacherLite', 'enrollExistingStudent')`.

## Success criteria

- Int test green: (a) enroll ok, (b)+(c) dup rejected (active+archived), (d) soft overCapacity, (e) facility guard.
- No P2002/500 leaks — clean CONFLICT.
- UI: director can add an existing student to a class from the class hub; teacher cannot see the action.
- Row shape identical to `enrollment.enroll` output (rollback-safe).

## Risk / security

- Risk: archived-enrollment dup → P2002/500 if not pre-checked (schema.prisma:396 unique has no
  archivedAt) → mitigated by findUnique pre-check + P2002 catch. Covered by test (c).
- Risk: cross-facility enroll → mitigated by assertFacilityAccess + RLS (withRls facilityIds).
- Security/governance: decision 0040 — mutation keeps RLS + audit + requirePermission (anti-escalation).
  No email, no CRM side effects (narrower blast radius than enrollment.enroll). No schema/migration.

## Next steps

Phase 4 verifies the enrolled student appears in roster + LMS (exercise-open picks up active enrollment).
