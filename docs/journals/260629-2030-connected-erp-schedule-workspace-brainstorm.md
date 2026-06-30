---
title: "Connected ERP Schedule Workspace Brainstorm"
date: 2026-06-29
scope: report-only-brainstorm
intake: 27
related_report: ../../plans/reports/brainstorm-260629-2030-connected-erp-schedule-workspace-report.md
---

# Connected ERP Schedule Workspace Brainstorm

## Context

User raised the core ERP UX problem: modules feel isolated. `/#schedule` should not be only a list; it should connect to lesson detail, class detail, student detail, teacher/staff profile, and safe activity logs.

## What Happened

- Ran Harness matrix and recorded high-risk intake #27.
- Scouted current admin app and API state around schedule, class workspace, student detail, staff profile, and audit/chatter.
- Wrote report-only brainstorm: `plans/reports/brainstorm-260629-2030-connected-erp-schedule-workspace-report.md`.
- No code changes, no database schema changes, no Microsoft Graph scope, no visual redesign.

## Reflection

The project already has the seed of connected navigation: `/#schedule` can jump to `/#classes` with `NavAction`, Student Detail exists, Class Detail has tabs, and Staff Profile U1 exists. The missing product shape is a clear Entity Workspace pattern, starting with Session Detail.

## Decisions

- Use **Schedule Detail first** as the concrete proof of connected ERP navigation.
- Use **Entity Workspace** as the long-term pattern: each important record gets a detail surface, related links, permission-gated tabs, and activity context.
- Do not solve this by scattered link patches only.
- Do not reuse open `Chatter` for staff/user/facility timelines; preserve audit security boundary.
- Keep this session report-only; implementation must go through a later plan.

## Next

- If approved, create a plan for Phase 1: Schedule Detail read workspace.
- Resolve open questions from the report: placement of Session Detail, query/hash link strategy, teacher Staff Profile permission, and session notes/log scope.
