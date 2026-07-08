---
phase: 2
title: "Teacher Screen Rebuild"
status: pending
priority: P1
dependencies: [1]
---

# Phase 2: Teacher Screen Rebuild

## Overview

Use `/stitch` to rebuild 3 teacher-facing screens: Today's Classes dashboard, Session Workspace (attendance + photos + notes unified), and Homework Grading feed. All tRPC calls stay unchanged — only the UI layer changes.

## Requirements

- Functional: same data as current screens, better grouped and task-focused
- Non-functional: ≤3 taps to mark attendance, photos + comments in same view as attendance

## Architecture

All components live in `apps/admin/src/`. No new routes — existing shell.tsx routing maps sections to components. Replace component implementations, keep export names.

Key tRPC endpoints per screen:

**TeacherTodayPanel** (replaces overview for teacher role):
- `trpc.schedule.listSessions` — today's sessions
- `trpc.classBatch.list` — class metadata

**SessionWorkspace** (replaces class-workspace + attendance-panel + session-evidence-panel):
- `trpc.attendance.listBySession` + `trpc.attendance.bulkMark` — roster + mark
- `trpc.sessionEvidence.get` + `trpc.sessionEvidence.upsert` — notes
- `trpc.sessionEvidence.uploadPhoto` — photo upload

**HomeworkFeed** (replaces grading.tsx):
- `trpc.submission.listByTeacher` — pending submissions
- `trpc.grade.upsert` — submit grade + stars

## Related Code Files

- Modify: `apps/admin/src/overview-panel.tsx` — replace teacher-role branch with `TeacherTodayPanel`
- Modify: `apps/admin/src/class-workspace.tsx` — consolidate into `SessionWorkspace`
- Modify: `apps/admin/src/attendance-panel.tsx` — inline into SessionWorkspace
- Modify: `apps/admin/src/session-evidence-panel.tsx` — inline into SessionWorkspace
- Modify: `apps/admin/src/grading.tsx` — replace with HomeworkFeed layout

## Implementation Steps

1. Run `/stitch` for **TeacherTodayPanel**:
   - Prompt: "Build a Today's Classes card list for a teacher portal. Each card shows: class code, course name, session time, room, student count. Status badge: upcoming / in-progress / done. Click card → navigate to SessionWorkspace. Mobile-friendly 2-col grid. Mantine components."
   - Wire to `trpc.schedule.listSessions({ date: today, teacherId: me.id })`
   - Replace the teacher-branch in `overview-panel.tsx`

2. Run `/stitch` for **SessionWorkspace**:
   - Prompt: "Build a 3-panel session workspace. Left: student roster list with attendance checkboxes (present/absent/late) + bulk mark-all button. Center: session notes textarea + photo upload grid (drag-drop, preview thumbnails). Right: session info (date, time, room, teacher). Save button publishes evidence. Mantine components."
   - Wire attendance panel: `trpc.attendance.listBySession` → `trpc.attendance.bulkMark`
   - Wire evidence panel: `trpc.sessionEvidence.get` / `upsert` / `uploadPhoto`
   - Replace `class-workspace.tsx` teacher session view

3. Run `/stitch` for **HomeworkFeed**:
   - Prompt: "Build a homework grading feed. Left column: list of student submissions grouped by exercise name. Each row: student name, submission date, status badge. Click row → right panel opens submission preview (PDF viewer or text). Right panel: score input (0–10) + star rating (1–5) + comment textarea + Save button. Mantine components."
   - Wire: `trpc.submission.listByTeacher` → `trpc.grade.upsert`
   - Replace `grading.tsx`

4. Run typecheck after each component: `pnpm --filter @cmc/admin typecheck`

5. Run nav tests: `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts`

## Success Criteria

- [ ] TeacherTodayPanel shows today's sessions as cards (not list table)
- [ ] SessionWorkspace shows roster + attendance + evidence in one screen
- [ ] Bulk "mark all present" works in ≤1 click
- [ ] Photo upload + notes save without leaving attendance view
- [ ] HomeworkFeed shows submissions grouped by exercise
- [ ] Grading saves score + stars in one action
- [ ] `pnpm --filter @cmc/admin typecheck` passes
- [ ] `nav-teacher-consolidation.test.ts` passes

## Risk Assessment

- **Medium**: `class-workspace.tsx` has complex navAction/goToClass wiring — read file carefully before modifying; only replace the session-day view, keep class-level navigation intact
- **Low**: attendance bulk mark already exists (`bulkMark`), just needs UI wrapper
- **Low**: session evidence upload already exists, just needs UI wrapper
