---
title: "P4 — Re-skin: CRM cockpit + pipeline"
description: "biz-director-cockpit-panel.tsx + crm-panel.tsx + opportunity-detail.tsx onto P1 tokens, preserving the just-shipped stage-stepper fix and Modal-ized form."
status: pending
priority: P3
effort: TBD
branch: TBD (create from P1's merge point, not main/develop — needs P1's finalized tokens)
tags: [ux, ui-rebuild, crm]
created: 2026-07-03
updated: 2026-07-03
---

## Overview

Plan 4 of 7. Depends on P1 only.

**Red-team correction (2026-07-03)**: original scope list omitted `opportunity-detail.tsx` despite `crm-panel.tsx` importing and rendering `OpportunityDetailPanel` from it (`crm-panel.tsx:38,224`). This file was just modified in commit `2bb1ad5` (stage-stepper "current" color fix, finding #6, + Modal-ized test-schedule form) — re-skinning `crm-panel.tsx` without explicitly including `opportunity-detail.tsx` risks silently reverting that fix if the color-token change touches the stepper's active-state styling.

**Sequencing note vs P7**: `crm-panel.tsx` directly consumes `DataTable`/`ViewSwitcher`/`useViewSwitcher` from `@cmc/ui` (`crm-panel.tsx:8-16`) — the exact primitives P7 re-skins. No file-level conflict (P4 and P7 touch disjoint files), but if P7 changes those primitives' prop shape or visual behavior while P4 is mid-flight, P4 may need rework. Land P7 before or check its final interface before starting P4's DataTable/ViewSwitcher-dependent portions, even though they can technically branch in parallel.

## Scope (detail when P1 lands)

Re-skin `apps/admin/src/biz-director-cockpit-panel.tsx`, `crm-panel.tsx`, **`apps/admin/src/opportunity-detail.tsx`** to new Zero Elevation tokens. Reference: `plans/reports/` earlier `/stitch` CRM director dashboard wireframe (finding #26).

## Dependencies

- Depends on: P1
- Soft-depends on: P7 (shared primitive interface, not shared files — see sequencing note above)
- Independent of: P2, P3, P5, P6

## Acceptance criteria (draft — finalize when detailed)

- Stage-stepper "current" stage highlight (fixed in `2bb1ad5`) remains functionally correct after re-skin.
- Modal-ized create-lead and test-schedule forms (from `2bb1ad5`) remain functional, not reverted to inline forms.
- No prop-shape break against P7's finalized `DataTable`/`ViewSwitcher` interface.
