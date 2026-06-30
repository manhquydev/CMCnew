# Phase 01 — Session Detail Read View

## Context Links

- Plan: `plan.md`.
- `apps/admin/src/schedule-panel.tsx` — current `/#schedule`; row click `goToClass(batch.id,'sessions')` (L159-163). Source of the navigation entry point.
- `apps/admin/src/App.tsx` — `goToClass` (L714-719), section render switch (L729-825), hash routing (L680-725).
- `apps/admin/src/class-workspace.tsx` — `NavAction` (L55-65), `ClassDetail` tabs (L692-719), `AttendanceRoster` use (L601-608), `SessionsTab` (L292-343).
- `apps/admin/src/student-detail.tsx` — multi-tab detail pattern to mirror.
- `apps/api/src/routers/schedule.ts` — `listSessions({classBatchId})` (L71-80), `mySessions` (L84-130).
- `apps/api/src/routers/enrollment.ts` — `listByBatch` roster source.
- `packages/db/prisma/schema.prisma` — `ClassSession` (L286-307), `Enrollment` (L311-333). No change.

## Overview

Add a Session Detail read view reachable from `/#schedule`. It shows one lesson's full context: header (date/time/status/room/teacher), class card, enrolled-student roster, attendance, and class activity log. Read-only; no new write power; no schema change.

## Requirements

- New entry point: clicking a schedule row opens Session Detail for that session (not only the class sessions tab). Keep the existing "open class" affordance available too (e.g. a class-code link inside the detail).
- Session Detail content:
  - Header: session date, start–end time, status badge, room name, teacher name.
  - Class card: batch code/name/course/status (links to Class Detail — wired in P2).
  - Roster: students enrolled in the session's class (active enrollments), each row prepared for a P2 deep-link to Student Detail.
  - Attendance: reuse `AttendanceRoster` for this `classSessionId` (read or edit per Open Decision 3).
  - Activity log: class-level `Chatter entityType="class_batch"` (P3 confirms/locks this).
- No data a viewer cannot already read: every query used is an existing permission-gated/protected procedure.

## Architecture / Approach

- Decide data path (plan Open Decision 2):
  - Reuse path (recommended MVP): in the `schedule` section, hold the selected `sessionId` + its `classBatchId` in state; fetch via existing `schedule.listSessions` (or filter `mySessions`) for header, `enrollment.listByBatch` for roster, `AttendanceRoster` for attendance.
  - New-query path (only if needed): add `schedule.sessionDetail({sessionId})` returning session + batch + roster shape. Add ONLY if client assembly causes N+1 or a permission gap.
- Navigation: extend `NavAction` (or a parallel schedule-local state) to carry `sessionId`; keep hash `SectionKey='schedule'`. Do NOT add query-param routing this phase.
- Component: new `apps/admin/src/schedule-detail.tsx` (`ScheduleDetailPanel`) mirroring `student-detail.tsx` structure; render inside the `schedule` section with a back action to the schedule list.

## Implementation Steps (for the later build phase)

1. Run `gitnexus_impact` on `SchedulePanel`, `goToClass`, and `NavAction` before editing; report blast radius.
2. Create `schedule-detail.tsx` read view consuming existing queries.
3. Add a "view session detail" affordance to `schedule-panel.tsx` rows (keep existing class jump).
4. Wire selection state in `App.tsx` schedule section; add back navigation.
5. Keep class-code + student rows as placeholders for P2 deep-links.

## Validation

- Admin typecheck clean.
- Manual/e2e: from `/#schedule`, open a session → see header + class + roster + attendance + log.
- No FORBIDDEN for a normal teacher viewing their own facility's session.
- No salary/user sensitive query fired.
- `gitnexus_detect_changes` shows only expected files.

## Risks and Rollback

- Risk: duplicating roster logic. Mitigation: reuse `enrollment.listByBatch` and `AttendanceRoster`, do not reimplement.
- Risk: navigation regression in existing `goToClass`. Mitigation: keep `goToClass` intact; add the session path beside it.
- Rollback: remove `schedule-detail.tsx` + the new row affordance; `/#schedule` reverts to today's behavior.
