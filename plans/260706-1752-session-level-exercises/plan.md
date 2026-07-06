---
title: "Session-Level Exercises"
description: "Move LMS homework/test assets from curriculum-unit level to lesson/session-level assignment."
status: pending
priority: P1
effort: 16h
branch: develop
tags: [feature, database, api, frontend, lms, high-risk]
created: 2026-07-06
---

# Session-Level Exercises

## Overview

Implement `CurriculumLesson` as the per-session template under each
`CurriculumUnit`, then attach `Exercise` to lesson templates and open/grade by
ended `ClassSession.curriculumLessonId`.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---:|---:|---|
| 1 | Decision/story/schema plan | Pending | 2h | [phase-01](./phase-01-decision-schema.md) |
| 2 | Migration + seed/backfill | Pending | 4h | [phase-02](./phase-02-migration-seed.md) |
| 3 | API open/submission/grade contracts | Pending | 4h | [phase-03](./phase-03-api-contracts.md) |
| 4 | Teacher/LMS UI | Pending | 3h | [phase-04](./phase-04-ui.md) |
| 5 | Tests, deploy, docs | Pending | 3h | [phase-05](./phase-05-validation-deploy-docs.md) |

## Dependencies

- Decision `0038` supersedes `0022`.
- Existing dirty teacher-surface worktree must be preserved.
- Any schema edit requires migration + Prisma generate.

## Acceptance

- 12-unit/48-session course exposes 48 lesson upload slots.
- Same unit can have multiple homework files, one per lesson.
- Student access/submission follows ended class session, not whole unit.
- Teacher grading can identify session/lesson context.
- Dev and prod deploy smoke passes after tests.
