---
title: "P6 — Re-skin: Meetings + Attendance report onto calendar-view"
description: "meetings-panel.tsx (parentMeeting) + attendance-report-panel.tsx onto packages/ui/src/calendar-view.tsx (P3), plus Bucket-B #29/#32 fixes."
status: pending
priority: P3
effort: TBD
branch: TBD (create from P1's merge point — meetings-panel.tsx already has an uncommitted diff on the current branch, see below)
tags: [ux, ui-rebuild, meetings, attendance]
created: 2026-07-03
updated: 2026-07-03
---

## Overview

Plan 6 of 7. First real consumer of P3's `calendar-view.tsx` for parentMeeting. Also folds in finding #29 (attendance report redesigned from roll-call table into trend/summary, per earlier `/stitch` wireframe review), #11 (parent-meeting schedule surfacing in LMS), and #32 (added by red-team, see below).

**Red-team correction (2026-07-03)**: `apps/admin/src/meetings-panel.tsx` already has an uncommitted diff on the current working branch (`feat/phase-d-facility-picker-and-stitch-wireframes`) from a prior session — this plan's original write-up didn't acknowledge it. Before starting, run `git diff apps/admin/src/meetings-panel.tsx` and reconcile: either that diff is unrelated prior work to commit separately first, or it needs folding into this plan's scope.

**Scope gap fix (red-team correction)**: Bucket-B finding **#32** ("attendance buried under 'Buổi học (ảnh & nhận xét)' label for parent/student, not findable as 'attendance'") was unassigned to any of the 7 plans — added here since it's attendance-adjacent and this plan already touches attendance surfaces.

## Scope (detail when P1+P3 land)

- `apps/admin/src/meetings-panel.tsx` — adopt calendar-view for parentMeeting entity. Reconcile pre-existing uncommitted diff first (see above).
- `apps/admin/src/attendance-report-panel.tsx` — redesign per approved wireframe (trend chart + KPI cards + drill-down table, not just monthly table).
- LMS parent-facing meeting schedule (finding #11) — separate surface, new screen per approved wireframe.
- LMS attendance naming/discoverability (finding #32) — relabel/surface "Buổi học (ảnh & nhận xét)" so attendance is findable by that name for parent/student personas.

## Dependencies

- Depends on: P1, P3
- Independent of: P2, P4, P5, P7
