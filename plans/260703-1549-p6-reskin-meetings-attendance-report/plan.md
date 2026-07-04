---
title: "P6 — Re-skin: Meetings + Attendance report onto calendar-view"
description: "meetings-panel.tsx (parentMeeting) onto packages/ui/src/calendar-view.tsx (P3), plus Bucket-B #29/#32 fixes. #11 dropped — already resolved in production."
status: implemented
priority: P3
effort: normal
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, ui-rebuild, meetings, attendance]
created: 2026-07-03
updated: 2026-07-03
---

## Overview

Plan 6 of 7. First real consumer of P3's `calendar-view.tsx` for parentMeeting. Also folds in
finding #29 (attendance report redesigned from roll-call table into trend/summary) and #32.

**Finding #11 DROPPED (user-confirmed, 2026-07-03)**: red-team discovered a `MeetingsCard`
component already exists in `apps/lms/src/parent-view.tsx` (lines 164-240, mounted unconditionally
on every parent tab), calling the already-existing `trpc.parentMeeting.myMeetings.query()`
(`apps/api/src/routers/parent-meeting.ts:38-47`), showing upcoming/past meetings. Shipped in
commit `ce2c7ba`, hardened in `7d3f2d2`. This is the same class of false-positive as findings
#1-#3 in the master report (persona-QA agent didn't individually re-verify #11, per the master
report's own correction note). The original persona-QA complaint ("no parent-meeting schedule
surfaces anywhere in the parent LMS UI") is factually resolved already. No new LMS screen needed.

**Red-team correction (stale, no longer applies)**: an earlier draft of this plan flagged
`meetings-panel.tsx` as having an uncommitted diff — re-verified 2026-07-03, `git status` shows
no local changes to that file. Non-issue.

**Scope gap fix (red-team correction)**: Bucket-B finding **#32** ("attendance buried under
'Buổi học (ảnh & nhận xét)' label for parent/student, not findable as 'attendance'") was
unassigned to any of the 7 plans — added here since it's attendance-adjacent and this plan
already touches attendance surfaces.

## Scope

- `apps/admin/src/meetings-panel.tsx` — adopt `CalendarView` for parentMeeting entity, synthesizing
  a default `end` (meeting has no duration field, `scheduledAt` only). Note: current table has
  per-row action buttons (Chốt giờ/Đã họp/Hủy/Ghi chú) — `CalendarView` has no inline-action slot,
  only `onEventClick`; these actions need to move into a click-triggered modal/drawer, not a
  simple rendering swap (red-team finding).
- `apps/admin/src/attendance-report-panel.tsx` — redesign per approved wireframe (trend chart +
  KPI cards + drill-down table). Backend: `apps/api/src/routers/attendance.ts`'s `report`
  procedure already has a reusable `byMonth`/`ictMonthKey` aggregation pattern (lines 209-287) but
  only for `scope: student|class|term` — needs extending with a facility-wide trailing-6-month
  scope, reusing that pattern rather than building aggregation from scratch (red-team finding).
- LMS attendance naming/discoverability (finding #32) — relabel/surface "Buổi học (ảnh & nhận xét)"
  so attendance is findable by that name for parent/student personas.

## Dependencies

- Depends on: P1, P3
- Independent of: P2, P4, P5, P7

## Implementation Summary (2026-07-03)

**A.** `meetings-panel.tsx` migrated onto `CalendarView` (P3). `ParentMeeting` rows synthesize a
60-minute `end` (no native duration field). `CalendarView` has no inline-action slot, so per-row
actions (Chốt giờ/Đã họp/Hủy/Ghi chú) moved into a click-triggered `MeetingDetailModal` that
dispatches into the existing `SetScheduleModal`/`SetNoteModal` or calls `setStatus` directly.

**B.** `attendance-report-panel.tsx` redesigned: `StatCard` KPIs (with vs-last-month delta), a
hand-built trend bar chart (no charting library in this workspace), and — for a new facility-wide
scope — a per-class drill-down table. Backend: `attendance.ts`'s `report` procedure extended with
`scope: 'facility'` reusing the existing `byMonth`/`ictMonthKey` pattern over a trailing 6-calendar-
month window, plus a new `byClass` aggregation. Authorization: the facility filter is app-layer
belt-and-suspenders on top of Postgres RLS (`withRls`/`rlsContextOf`), which is the actual trust
boundary — a caller can't read another tenant's facility data regardless of the `facilityId` they pass.

**C.** Finding #32: nav label "Buổi học (ảnh & nhận xét)" → "Điểm danh & buổi học" (parent + student
LMS shells). This is not cosmetic-only — students had NO attendance display under that tab at all
(only session-evidence photos/comments); `AttendanceHistoryCard` was extracted from `parent-view.tsx`
into a shared `apps/lms/src/attendance-history-card.tsx` and wired into `student-view.tsx`'s sessions
tab too, backed by the existing `attendance.forStudent` `lmsProcedure` (already scoped correctly for
a student's own `studentIds`).

Verification: `pnpm --filter @cmc/admin exec vitest run` 27/27 pass; `tsc --noEmit` clean across
`@cmc/api`, `@cmc/admin`, `@cmc/ui`, `@cmc/lms`, and `pnpm -w typecheck` (12/12 packages); ESLint
clean (0 errors, 0 warnings) on all touched files; `gitnexus_detect_changes({scope:'all'})` — medium
risk (expected, meetings event-handling flow changed), 3 affected processes all within the intended
scope; code-reviewer subagent found no blocking issues, explicitly verified the RLS trust boundary
for the new facility scope and the student attendance data-access path.

No `attendance.report` integration test exists for the new `facility` scope (existing int tests cover
`markAll`, not `report`) — acknowledged gap, not silently skipped; `pnpm --filter @cmc/api exec vitest run`
has no unit-level coverage for this procedure either (it's a DB-integration-shaped query, consistent
with how the pre-existing `student`/`class`/`term` scopes were also untested at this layer).
