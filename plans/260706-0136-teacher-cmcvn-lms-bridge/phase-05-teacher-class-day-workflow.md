---
phase: 5
title: "Teacher class day workflow"
status: verified
effort: "L"
---

# Phase 5: Teacher class day workflow

## Overview

Prove the existing teacher daily workflow works on teacher host and fix only server-side gaps needed for the requested flow: assigned classes/sessions, attendance, student comments, class photos, and homework grading.

Likely touchpoints:

- `apps/admin/src/attendance-panel.tsx`
- `apps/admin/src/attendance-roster.tsx`
- `apps/admin/src/class-workspace.tsx`
- `apps/admin/src/grading.tsx`
- session evidence UI files under `apps/admin/src`
- `apps/api/src/routers/attendance.ts`
- `apps/api/src/routers/session-evidence.ts`
- `apps/api/src/routers/submission.ts`
- `apps/api/src/routers/schedule.ts`
- `packages/auth/src/permissions.ts`

## Implementation Steps

1. Before editing, run GitNexus impact for modified symbols:
   - attendance mark/list/report procedures if changed.
   - session evidence upsert/publish procedures if changed.
   - submission grade/publish procedures if changed.
2. Confirm the teacher host landing filters to the teacher's assigned class/session context.
   - Existing admin shell/class workspace should be reused.
   - Do not redesign class day UX unless smoke reveals a blocker.
3. Ensure teacher views only relevant sessions:
   - Teacher sees own sessions/classes by existing server filters.
   - Director can inspect facility-wide education operations.
4. Keep server authority:
   - UI warnings can block obvious mistakes, but API permissions/RLS decide.
   - Current code has UI-only warnings for some assignment checks. Add server-side guards before claiming cross-class denial.
   - Shared rule: `giao_vien` may mutate only sessions/submissions tied to their assigned `ClassSession.teacherId`; director/super_admin retain facility-wide authority.
   - Apply the guard to attendance marking, session evidence draft/publish, and grading/publish paths as needed.
5. Ensure class evidence flow:
   - Draft comments/photos.
   - Publish to parent/student visibility.
   - Upload path uses existing session-evidence upload permissions.
6. Ensure grading flow:
   - Teacher lists submissions for an exercise.
   - Teacher opens student layer, writes feedback/annotation, grades, publishes if required.
   - Parent/student visibility follows existing grade publish contract.

## Success Criteria

- [x] `giao_vien` can find today's/assigned class from teacher domain without using broad ERP navigation.
- [x] Teacher can mark attendance for enrolled active students.
- [x] Teacher can write comments and upload class photos, then publish evidence.
- [x] Teacher can grade submitted homework and publish feedback according to existing submission contract.
- [x] Parent/student see only published/allowed information.
- [x] Cross-class, cross-teacher, and cross-facility mutation attempts are denied by API/RLS, not only by UI.

## Status Update - 2026-07-06

Focused API tests cover attendance teacher assignment, session evidence publish/visibility, and other-teacher denial. Focused Playwright covers session evidence publish to LMS and parent/student visibility.

## Tests

- Existing tests stay green:
  - `apps/api/test/attendance-report-markall.int.test.ts`
  - `apps/api/test/session-evidence-publish-to-lms.int.test.ts`
  - `apps/api/test/schedule-my-sessions.int.test.ts`
  - submission grading/open tests listed in phase 4.
- Add test coverage if a teacher-host workflow changes API behavior.
- Add negative API tests for same-facility other-teacher mutation across attendance, session evidence, and grading.
- Playwright smoke: teacher login, open assigned class through existing UI, mark attendance, publish evidence, grade homework.

## Rollback

Keep API behavior backward compatible. If UI changes fail, revert teacher-host shortcuts while leaving existing class workspace, attendance, evidence, and grading pages available through ERP/admin.
