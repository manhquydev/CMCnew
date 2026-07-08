---
phase: 3
title: "Director Screen Rebuild"
status: pending
priority: P1
dependencies: [1]
---

# Phase 3: Director Screen Rebuild

## Overview

Use `/stitch` to rebuild 3 director-facing screens: Dashboard with stat cards + action list (matching design reference `approve-current.png`), Quick Class Creation wizard, and Student Enrollment panel. Parallel to Phase 2 — no file ownership conflicts.

## Requirements

- Functional: same operations as `teacher-lite-intake-panel.tsx` + `teacher-lite-class-control-panel.tsx` + `student-management-panel.tsx`
- Non-functional: director creates class ≤60s; adds student + triggers email in 1 form

## Architecture

Target roles: `giam_doc_dao_tao` and `giam_doc_kinh_doanh` on teacher surface.

Key tRPC endpoints per screen:

**DirectorDashboard**:
- `trpc.classBatch.list` — active classes count
- `trpc.schedule.listSessions` — today's sessions count
- `trpc.teacherLite.pendingActions` (if exists) or compute client-side from class/session data

**QuickClassForm** (replaces `teacher-lite-class-control-panel.tsx`):
- `trpc.teacherLite.createClass` — create class + auto-generate sessions
- `trpc.teacherLite.cancelClass` + `trpc.teacherLite.cancelSession` — cancel actions
- `trpc.facility.list` + `trpc.course.list` — dropdown data

**StudentEnrollPanel** (replaces `teacher-lite-intake-panel.tsx` + director part of `student-management-panel.tsx`):
- `trpc.teacherLite.createFamilyStudentAndEnroll` — one-shot add student + enroll + email parent
- `trpc.classBatch.list` — class selector for enrollment

## Related Code Files

- Modify: `apps/admin/src/teacher-lite-intake-panel.tsx` — replace with `DirectorDashboard` + route to sub-panels
- Modify: `apps/admin/src/teacher-lite-class-control-panel.tsx` — replace dense form with `QuickClassForm` wizard
- Modify: `apps/admin/src/student-management-panel.tsx` — add `StudentEnrollPanel` tab for director role

## Implementation Steps

1. Run `/stitch` for **DirectorDashboard**:
   - Prompt: "Build a director dashboard for an education ERP. Top row: 4 stat cards — Active Classes (number + trend), Sessions Today (number), Pending Approvals (number, orange if >0), Threshold Alerts (number, red if >0). Below left: action list titled 'Việc cần bạn xử lý' with items showing title, count badge, status chip (Chờ/Cộng tiền/etc) and chevron. Below right: today's session progress bars (confirmed/attendance-marked/notes-done out of total). Mantine components, CMC EDU brand (blue accent)."
   - Wire stat cards to: `trpc.classBatch.list` (count active), `trpc.schedule.listSessions({ date: today })` (count)
   - Replace `teacher-lite-intake-panel.tsx` for director roles

2. Run `/stitch` for **QuickClassForm**:
   - Prompt: "Build a 2-step class creation wizard. Step 1: select Facility (dropdown) + Course (dropdown) + Capacity (number, optional). Step 2: Start Date + End Date (date pickers) + Day of Week (chip group: Mon–Sun multi-select) + Start Time + End Time (time inputs). Preview text: 'Sẽ tạo X buổi học'. Create button. Below the wizard: a compact cancel section — dropdown to select active class, reason input, red Cancel Class button. Mantine components."
   - Wire: `trpc.teacherLite.createClass` + `trpc.teacherLite.cancelClass` + `trpc.teacherLite.cancelSession`
   - Replace `teacher-lite-class-control-panel.tsx`

3. Run `/stitch` for **StudentEnrollPanel**:
   - Prompt: "Build a student enrollment form for a school director. Fields: Parent full name, Parent phone (Vietnamese format), Parent email (required for LMS account). Student full name, Student date of birth. Class selector (searchable dropdown). Submit button labeled 'Thêm học sinh & gửi email phụ huynh'. On success: show confirmation with email sent indicator. Mantine components."
   - Wire: `trpc.teacherLite.createFamilyStudentAndEnroll`
   - Insert as a tab/section in `student-management-panel.tsx` for director roles (keep existing student list for non-director view)

4. Run typecheck: `pnpm --filter @cmc/admin typecheck`

5. Run nav tests: `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-director-dt-cockpit-consolidation.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts`

## Success Criteria

- [ ] DirectorDashboard shows 4 stat cards with live data
- [ ] Action list renders (empty state acceptable for now)
- [ ] QuickClassForm creates class in ≤3 field interactions after selecting course + dates
- [ ] Cancel class/session works from same panel
- [ ] StudentEnrollPanel creates family + student + enrollment + queues parent email in 1 submit
- [ ] `pnpm --filter @cmc/admin typecheck` passes
- [ ] Director cockpit nav tests pass

## Risk Assessment

- **Low**: `teacher-lite-class-control-panel.tsx` is self-contained, safe to replace
- **Medium**: `student-management-panel.tsx` is shared between teacher and director — add director tab without removing existing student list view
- **Low**: `createFamilyStudentAndEnroll` already handles phone normalization + email queue — just wire to new form
