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
- Parent per-session visibility: `parent-view.tsx` `sessions` tab lists each session's status (not just aggregate).

## Files
- Modify: `apps/api/src/routers/attendance.ts` (add `markAll`, `report`). **File shared with P5 → this phase FIRST, then P5 layers lifecycle guard.**
- Modify: `apps/admin/src/attendance-roster.tsx` (mark-all button + submit bulk).
- Modify: `apps/lms/src/parent-view.tsx` (per-session status in sessions tab).
- No schema change → **no migration**.

## Implementation steps
1. `markAll`: single tx, load active enrollments for session, `upsert` each (skip left-class), set `markedById`/`markedAt`.
2. `report`: aggregate queries by scope; term scope joins sessions in term window; exclude `isMakeup` from denominator if operator wants "scheduled" rate — confirm, default include.
3. Roster UI: "Điểm danh tất cả có mặt" button → prefill present, allow per-row override + excused, single submit.
4. Parent sessions tab: render each session date + status badge (reuse status colors `:57`).

## Tests / validation
- Int: markAll sets all rows once, override respected, excused preserved, transferred skipped.
- Int: report counts correct across student/class/term.
- E2E: teacher one-tap mark-all; parent sees per-session list.

## Risks / rollback
- Risk (med): bulk upsert partial failure → wrap in one tx.
- Risk (med): merge conflict with P5 on same file → serialize (P3 merges before P5 starts).
- Rollback: revert code; no data migration.

## Blockers
- Depends on Plan 1 session shape. **Blocks P5** (shared file). Independent of P1/P2/P4.
