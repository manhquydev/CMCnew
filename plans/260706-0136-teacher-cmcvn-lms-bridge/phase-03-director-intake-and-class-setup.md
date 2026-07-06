---
phase: 3
title: "Director intake and class setup"
status: verified-draft-handoff
effort: "XL"
---

# Phase 3: Director intake and class setup

## Overview

Give directors the shortest supported path to create a family/student and put the student into a class, while preserving the accepted class-code and family-login invariants.

Likely touchpoints:

- `apps/api/src/routers/guardian.ts`
- `apps/api/src/routers/student.ts`
- `apps/api/src/routers/enrollment.ts`
- `apps/api/src/routers/class-batch.ts`
- `apps/api/src/services/student-provisioning.ts`
- `apps/api/src/services/email-outbox.ts`
- `apps/admin/src/guardians-panel.tsx`
- `apps/admin/src/class-workspace.tsx`
- `packages/auth/src/permissions.ts`
- `packages/db/prisma/schema.prisma` only if validation proves an unavoidable new field/table.

## Implementation Steps

1. Before editing, run GitNexus impact for every modified exported router procedure/helper:
   - `parentCreate`, `link`, new/director intake procedure if added.
   - `student.create` if changed.
   - `enroll` if changed.
   - `classBatch.create` only if class setup behavior changes.
2. Implement the validated intake decision:
   - MVP default: one director form creates a draft/provisioning handoff that later reuses `receiptApprove`; it must not activate a real student/enrollment outside the existing finance seam.
   - If direct active intake is explicitly accepted, it must be a new transactional director procedure, not a UI-only composition of multiple mutations.
   - Direct active intake must create/update `ParentAccount`, `Student`, `Guardian`, `StudentAccount`, and optional `Enrollment` atomically only after a new accepted decision exists.
   - It must keep decision 0033 invariants: parent phone normalized to `84xxx`, `ParentAccount.passwordHash` set only if empty, child `StudentAccount` retained as session anchor, no `kind:'parent'` session minted from phone+default login.
   - It must not overwrite an existing family password or hijack an existing parent email.
   - It must reuse or factor the existing receipt approval race-safe parent find-or-create semantics, including savepoints or `ON CONFLICT` handling inside a transaction.
   - It must add first-class provenance if it creates real student/enrollment rows outside receipt approval.
3. Handle duplicate and race cases explicitly:
   - Existing parent phone, same family: attach new student.
   - Existing parent email on another account: return actionable conflict or skip email propagation per validated decision, never raw 500.
   - Concurrent same phone creation: use race-safe find-or-create pattern.
   - Concurrent same student/class enrollment: map DB unique collisions to deterministic `CONFLICT` or use atomic upsert.
4. Preserve finance semantics:
   - If direct intake is accepted, mark created rows with audit/provenance that distinguishes director LMS intake from receipt-created student/enrollment.
   - If direct intake is not accepted, create the approved draft/receipt handoff instead.
5. Preserve class setup:
   - Class creation still calls existing class-code generator.
   - Director can select facility/course/schedule/teacher using existing constraints.
   - Enrollment uses existing duplicate/capacity handling unless validation changes it.
6. Resolve current director RBAC split:
   - Current code allows `classBatch.create` for `giam_doc_dao_tao` and `enrollment.enroll` for `giam_doc_kinh_doanh`.
   - If product requires one director to complete setup, update `packages/auth/src/permissions.ts`, permission tests, and role docs.
   - If handoff is accepted, UI must show which director owns each step and tests must cover the handoff.
7. UI:
   - Add one director form for parent+student, reusing existing field labels and validation patterns.
   - Require parent email and phone for the requested launch flow.
   - Show login instruction output exactly once when new credentials are created.
   - Add student-to-class action from class workspace.
8. Audit:
   - Add audit rows for family/student create/link/enroll.
   - Include actor, facility, target IDs, and provenance.
   - Do not write raw parent phone/email into human-readable audit bodies or generated reports; use IDs and masked values.

## Success Criteria

- [x] Both director roles can create the agreed parent+student artifact without super_admin.
  - `giam_doc_kinh_doanh` can use the receipt/provisioning handoff through `finance.receiptCreate`.
  - `giam_doc_dao_tao` can use the same draft-only receipt/provisioning handoff through `finance.receiptCreate`; `receiptApprove` remains restricted to `ke_toan` and `giam_doc_kinh_doanh`.
- [x] Class creation/enrollment authority follows the validated one-director or handoff decision.
  - No permission broadening was added; existing split/handoff remains.
- [x] A teacher cannot create parent/student or enroll students unless already allowed by existing permissions.
- [x] Family login works for newly created student through existing LMS phone/profile-picker flow.
- [x] New audit/event rows do not contain raw parent phone/email.
  - No new direct-intake audit/report body was added.
- [x] Duplicate parent phone/email scenarios are deterministic and tested.
- [x] Enrollment into class is facility-scoped and duplicate-safe.
- [x] Class code still matches decision 0036.
- [x] Parent welcome email is queued only when parent email is valid and allowed.
  - New-student receipt intake now captures parent email in the same parent+student form and passes it to `receiptCreate`.
  - Existing provisioning tests cover `lms_account_ready` queueing at `receiptApprove`; production Brevo readiness is tracked in phase 6/7.

## Status Update - 2026-07-06

No direct active parent+student intake was added. Focused proof relies on the existing receipt/provisioning and family-login flow, which preserves decision 0033 and existing rollback provenance.

The new-student receipt form now captures the requested parent+student launch fields in one intake surface: facility, course, parent phone, parent name, parent email, student name, optional student DOB, and optional class. It remains a draft/provisioning handoff: the real `Student`, `ParentAccount`, `Guardian`, `StudentAccount`, optional `Enrollment`, and parent notification are created at `receiptApprove`.

Follow-up resolved the education-director intake gap by granting `giam_doc_dao_tao` only the non-money draft gate: `finance.receiptCreate` plus the matching narrow `crm.opportunityLookup` gate required by decision 0037. The finance list/approve/send/reconcile/cancel gates remain closed to `giam_doc_dao_tao`, and the GĐĐT cockpit links to the existing one-form intake without showing the wider finance worklist.

Production deploy marker: `manual-teacher-dt-intake-20260706092700`, built at `2026-07-06T02:27:00Z`.

## Tests

- New API integration test for education-director draft intake success plus approval denial.
- New API integration test for duplicate phone, duplicate email, cross-facility denial, and teacher denial.
- New tests assert decision 0033 invariants: no password overwrite, normalized phone, child-selection ticket path, no parent-cookie mint from phone/default credential.
- New API integration test for concurrent duplicate enrollment.
- Permission matrix test for `classBatch.create`, `enrollment.enroll`, and any new intake procedure across KD/DT/teacher/super_admin.
  - `apps/api/test/permission-parity.test.ts` now asserts GĐĐT has only `finance.receiptCreate`/`crm.opportunityLookup` for intake and not finance approval/list/worklist or CRM board access.
- Existing student provisioning tests remain green:
  - `apps/api/test/student-provisioning-approve.int.test.ts`
  - `apps/api/test/student-provisioning-edge-cases.int.test.ts`
- Existing class/enrollment tests remain green:
  - `apps/api/test/batch-code-atomicity.int.test.ts`
  - `apps/api/test/class-batch-create-multislot.int.test.ts`

## Rollback

Keep old receipt approval and existing guardian/student flows untouched. If direct intake has to be disabled, hide the UI entry and block the new router procedure by permission/feature flag. Any cleanup must use the direct-intake provenance/draft records and must not delete rows blindly.
