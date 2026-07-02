---
title: "P3 — Attendance bulk mark-all + reports + parent per-session"
phase: 3
status: pending
risk: high
owns: [apps/api/src/routers/attendance.ts, apps/admin/src/attendance-roster.tsx, apps/lms/src/parent-view.tsx]
---

# P3 — Attendance bulk + reports + parent visibility

## Context
- Source: brainstorm §PLAN5.3. No bulk mark-all (per-student friction in `attendance-roster.tsx`); no report by student/class/term (only `listBySession`); parent sees only aggregate rate.
- Anchors (verified): `attendanceRouter` / `listBySession` `attendance.ts:9`; left-class guard `:60`; roster UI `apps/admin/src/attendance-roster.tsx`; parent gradebook/sessions `apps/lms/src/parent-view.tsx` (tabs incl. `sessions`, `:29`); `model Attendance` `schema.prisma:377` (`@@unique([classSessionId, enrollmentId])` `:391`, `excused` `:385`).

## Requirements
- Bulk `attendance.markAll({ classSessionId, defaultStatus, overrides[] })` — one call sets all active enrollments, honoring per-student overrides + `excused` checkbox (D-P5a: excused stays modifier, not a 4th status).
- Upsert on `@@unique([classSessionId, enrollmentId])`; respect left-class guard (`:60`) — skip transferred/withdrawn.
- Reports: `attendance.report({ scope: 'student'|'class'|'term', id, termId? })` → counts present/absent/late + excused, rate.
  - **Authz scope (N4):** teacher sees only their OWN classes; director sees facility-wide. `attendance.ts` currently has no role-scoping beyond `requirePermission('attendance','mark')` — `report` needs its OWN explicit authz: scope the query by the caller's owned classes for teacher role, facility for director. State it, don't inherit implicitly.
  - **TZ month-bucketing (N3):** term/month grouping MUST use the ICT offset. Reuse `ICT_OFFSET_HOURS = 7` / `sessionEndUtc` convention from `exercise-open.ts:4-22` — do NOT bucket on raw UTC `sessionDate`, or a 23:00 ICT session on a month's last day (stored next-day UTC) lands in the wrong month.
  - **isMakeup in denominator (N1):** default INCLUDE makeup sessions in the attended/total rate (a makeup a student attended counts). Recorded default; makeup rows are still excluded from `computeFinalGrade` recompute separately (P2).
- Parent per-session visibility: `parent-view.tsx` `sessions` tab lists each session's status (not just aggregate).

## Files
- Modify: `apps/api/src/routers/attendance.ts` (add `markAll`, `report`). **File shared with P5 → this phase FIRST, then P5 layers lifecycle guard.**
- Modify: `apps/admin/src/attendance-roster.tsx` (mark-all button + submit bulk).
- Modify: `apps/lms/src/parent-view.tsx` (per-session status in `sessions` tab). **File ALSO owned by P4 (gradebook-tab download buttons) → this phase lands its parent-view.tsx edit FIRST; P4 rebases on top. Disjoint tab regions but same file — NOT parallel-safe.**
- No schema change → **no migration**.

## Implementation steps
1. `markAll`: single tx, load active enrollments for session, `upsert` each (skip left-class), set `markedById`/`markedAt`.
2. `report`: aggregate queries by scope with explicit authz (teacher=own classes, director=facility, N4); term scope joins sessions in term window bucketed by ICT month (reuse `ICT_OFFSET_HOURS`, N3); `isMakeup` INCLUDED in denominator (N1 default).
3. Roster UI: "Điểm danh tất cả có mặt" button → prefill present, allow per-row override + excused, single submit.
4. Parent sessions tab: render each session date + status badge (reuse status colors `:57`).

## Tests / validation
- Int: markAll sets all rows once, override respected, excused preserved, transferred skipped.
- Int: report counts correct across student/class/term; ICT month-boundary session buckets into correct month (N3); teacher-scope sees only own classes, director sees facility (N4).
- E2E: teacher one-tap mark-all; parent sees per-session list.

## Risks / rollback
- Risk (med): bulk upsert partial failure → wrap in one tx.
- Risk (med): merge conflict with P5 on same file → serialize (P3 merges before P5 starts).
- Rollback: revert code; no data migration.

## Blockers
- Depends on Plan 1 session shape. **Blocks P5** (shares `attendance.ts`) AND **blocks P4** (shares `parent-view.tsx`) — P3 lands first for both. Independent of P1/P2.
