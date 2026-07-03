---
title: "P7 — Re-skin: List/Kanban templates + profile page + checkin discoverability"
description: "data-table.tsx, view-switcher.tsx onto P1 tokens; verify kanban drag-drop status first; also builds Bucket-B #19 profile/settings page and #12 checkin discoverability."
status: implemented
priority: P3
effort: normal
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, ui-rebuild, list, kanban]
created: 2026-07-03
updated: 2026-07-03
---

## Overview

Plan 7 of 7 (last in sequence, but independent of P4/P5/P6 — could run in parallel with them once P1 lands).

**Sequencing note vs P4** (red-team, see P4's plan.md): `crm-panel.tsx` (P4's target) directly consumes `DataTable`/`ViewSwitcher` from `@cmc/ui` (this plan's target). No file overlap, but P4 depends on this plan's finalized primitive interface — land P7 first or confirm interface stability before P4 starts its DataTable/ViewSwitcher-dependent portions.

**Scope gap fix (red-team correction)**: Bucket-B finding **#12** ("checkin nested under 'Lương & chấm công,' not discoverable as its own item") was unassigned to any of the 7 plans — added here as the most natural home for a nav-discoverability fix alongside the other list/nav work in this plan.

## Scope (detail when P1 lands)

- `packages/ui/src/data-table.tsx` — re-skin to Zero Elevation.
- `packages/ui/src/view-switcher.tsx` — **verify first**: does it implement true drag-drop kanban or just a list/kanban toggle stub? (unresolved from earlier scout). This determines whether kanban re-skin is cosmetic or needs functional work too.
- Finding #19 (no profile/settings page reachable from avatar — hits 3 personas) — build using the approved `/stitch` wireframe from earlier review, new screen, not a re-skin.
- Finding #12 (checkin nav discoverability) — surface "Chấm công" as its own top-level nav item or otherwise make it discoverable without requiring a first-day teacher to guess it's under "Lương & chấm công".

## Dependencies

- Depends on: P1
- Independent of: P2, P3, P4, P5, P6
- P4 soft-depends on this plan's finalized DataTable/ViewSwitcher interface (see sequencing note)

## Implementation Summary (2026-07-03)

Committed `2cdb892`. (A) Token re-skin of `data-table.tsx`/`view-switcher.tsx` — no-op, already
compliant, verified not just assumed. (B) Finding #19: real profile/settings page + avatar `Menu`
built (red-team found no dropdown existed at all — a bare `<Avatar>`; `RecordDetailPanel` didn't fit
the shape, built as a plain Mantine form instead per red-team recommendation). (C) Finding #12: checkin
relabeled for discoverability (user-confirmed: relabel only, keep the existing nav grouping, zero test
changes) — adding a routable section actually required 5 coordinated file edits (SectionKey union,
SECTION_TITLES, NAV_GATES, ALL_SECTION_KEYS+renderContent switch, nav-consistency.test.ts), not a
single-line change as the phase file originally assumed.
