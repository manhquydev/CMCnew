# LMS Session Evidence Overview

## Current Behavior

- `/grading` lets staff create exercises, grade submissions, annotate PDF work, and publish scores.
- Session data exists as `ClassSession` and `Attendance`.
- Class creation now supports an optional first weekly lesson slot; the API creates `ClassBatch` and the first `ScheduleSlot` atomically.
- Staff can open a schedule session detail view with a time-derived "Session 360" workflow panel.
- LMS shows exercises/results/gradebook, but not per-session photos or teacher session comments.

## Implemented Vertical Slice

- Admin class creation captures first lesson day, start time, end time, room, and teacher.
- `classBatch.create` accepts optional `initialSlot` and creates the first schedule slot in the same transaction.
- Schedule detail calculates the phase from session start/end time:
  - before class: session information and roster,
  - from 15 minutes before start: attendance workflow is open,
  - after session end: post-class cards appear.
- Post-class cards are mock placeholders for LMS homework publish, template comments, whole-class photo upload, and parent publish.

## Target Behavior

- Teacher records evidence for each class session: photos, class summary, and per-student session comments.
- Teacher comments are template/form based and do not require approval before parent visibility.
- Published session evidence appears in LMS for the parent/student, scoped to owned child.

## Affected Users

- `giao_vien`
- `head_teacher`
- `quan_ly`
- Parent account
- Student LMS account

## Affected Product Docs

- `README.md`
- `docs/roadmap.md`
- `docs/operate-and-test-guide.md`
- `docs/TEST_MATRIX.md`

## Non-Goals

- Push notifications.
- Cloud image storage provider.
- Moderation/face blur.
- Native mobile UI.
- Persisted session photo/comment/LMS publish in the current vertical slice.
