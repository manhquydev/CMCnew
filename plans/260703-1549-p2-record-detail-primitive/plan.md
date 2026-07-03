---
title: "P2 — Primitive: generic record-detail component"
description: "Extract packages/ui/src/record-detail.tsx from staff-profile.tsx's Tabs+Chatter pattern, parameterized for any entity."
status: pending
priority: P2
effort: TBD (detail when P1 lands)
branch: TBD (create from P1's merge point)
tags: [ux, ui-rebuild, primitive]
created: 2026-07-03
---

## Overview

Plan 2 of 7 (`plans/reports/brainstorm-260703-1549-erp-ui-rebuild-7-plan-decomposition-report.md`). Depends on P1 (token remap) landing first — this primitive is built with the final Elevation doctrine from the start, not retrofitted.

Research already done: `plans/260703-1543-erp-ui-rebuild-phase-ab-token-primitives/reports/researcher-260703-1549-record-detail-calendar-primitives-report.md` — has exact parameterization table (fieldLabels, formatValue, tabs[], sections[], entityType, permission callbacks) extracted from `apps/admin/src/staff-profile.tsx`'s current Tabs+Chatter wiring.

## Scope (to detail once P1 lands)

Build `packages/ui/src/record-detail.tsx`: 2-col label|value form grid + Tabs (won over accordion in prior `/stitch` review — matches staff-profile.tsx's shipped pattern) + right-rail ActivityLog. Reference implementation: `staff-profile.tsx`.

## Dependencies

- Depends on: P1 (token remap)
- Blocks: P5 (staff-profile re-skin, first real consumer), and any future entity detail-page

## Acceptance criteria (draft — finalize when detailed)

- Component accepts `fieldLabels`, `formatValue`, `tabs[]`, `sections[]`, `entityType`, per-section/tab `permission` callback.
- `staff-profile.tsx` can be refactored to consume it with zero visual/behavior change (proven in P5, not this plan).
- Uses P1's finalized Elevation tokens.

## Unresolved questions (from research)

1. Field-render extensibility — custom `render()` beyond a type-enum, or is type-enum sufficient for all known entities?
2. ActivityLog refresh strategy — auto-poll, WebSocket, or manual `refreshKey` (current staff-profile pattern)?
