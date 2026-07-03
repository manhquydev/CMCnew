---
title: "P3 — Primitive: calendar-view (week default, month secondary)"
description: "Hand-built packages/ui/src/calendar-view.tsx — @mantine/dates 7.15.2 has no week/month view."
status: pending
priority: P2
effort: TBD (detail when P1 lands)
branch: TBD (create from P1's merge point)
tags: [ux, ui-rebuild, primitive]
created: 2026-07-03
---

## Overview

Plan 3 of 7 (`plans/reports/brainstorm-260703-1549-erp-ui-rebuild-7-plan-decomposition-report.md`). Depends on P1 (token remap). Independent of P2 (can run in parallel with P2 once P1 lands — disjoint files).

Research already done: `plans/260703-1543-erp-ui-rebuild-phase-ab-token-primitives/reports/researcher-260703-1549-record-detail-calendar-primitives-report.md` — confirms `@mantine/dates` 7.15.2 has Calendar/DatePicker/MiniCalendar/TimeGrid but NOT week/month/day view components. Must hand-build using dayjs + Mantine Grid/Badge/ActionIcon (matches `odoo-parity-ux-framework` plan's original recommendation to avoid a heavy calendar dep).

## Scope (to detail once P1 lands)

Week view default (won over month in prior `/stitch` review — all 4 first-consumer entities are time-slotted/operational, need hour-of-day granularity). Month view as togglable secondary mode.

**First consumers** (from `view-defaults.ts`, entities defaulting to `'calendar'`): `testAppointment`, `scheduleSession`, `parentMeeting`, `attendance`.

## Dependencies

- Depends on: P1 (token remap)
- Blocks: P6 (meetings/attendance-report re-skin uses this for parentMeeting/attendance calendar surfaces)

## Acceptance criteria (draft — finalize when detailed)

- Week grid: 7-day columns, hour-of-day rows, event blocks with title/time/status.
- Month grid: 6-week x 7-day, event chips + overflow.
- Both driven by the same underlying data shape so entities can plug in without per-entity calendar logic.
- Uses P1's finalized Elevation tokens.

## Unresolved questions (from research)

1. Locale/week-start (Monday vs Sunday) — configurable prop or hardcoded VN convention (Monday)?
