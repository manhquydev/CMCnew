---
title: "P1 — Token remap: Zero Elevation (Vietnamese Enterprise Core 3)"
description: "Remove decorative shadows from docs/design-system.md + tokens.css + theme.ts, keep functional depth-cues, TDD-locked (object-assertion test, not component-render test)."
status: pending
priority: P1
effort: 4h (was 3h — red-team found blast radius larger than initial research)
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, design-tokens, ui-rebuild]
created: 2026-07-03
updated: 2026-07-03
---

## Overview

Plan 1 of 7 in the ERP UI rebuild sequence (`plans/reports/brainstorm-260703-1549-erp-ui-rebuild-7-plan-decomposition-report.md`). No dependency — start immediately. Plans 2-7 all depend on this landing first (they consume the new token values).

**Pre-step required (red-team finding, 2026-07-03)**: this branch already has an uncommitted `packages/ui/src/facility-picker.tsx` diff (from a prior session's FacilityPicker DRY refactor) and an uncommitted `apps/admin/src/meetings-panel.tsx` diff (P6's target file). Commit or explicitly fold these into scope BEFORE starting Phase 1 — the original brainstorm flagged this risk but it was dropped when this plan was first written. Run `git status --short` and reconcile before touching `theme.ts`.

Research: `plans/260703-1543-erp-ui-rebuild-phase-ab-token-primitives/reports/researcher-260703-1549-shadow-blast-radius-report.md` (initial estimate) + `reports/code-reviewer-260703-1557-shadow-remap-plan-red-team-plan-review-report.md` (red-team, corrects the estimate — read this one for the real numbers).

## Scope

Move from current shadow doctrine (`--cmc-shadow-sm` resting cards, `--cmc-shadow-xl` modals) to "Zero Elevation" (Vietnamese Enterprise Core 3 style-direction, chosen via brainstorm) for **decorative** shadows only. Functional depth-cues (dropdown/menu/notification z-layer separation) stay — verify with user which specific tokens count as functional before zeroing (see Unresolved Questions).

**Blast radius (red-team corrected — was undercounted at ~12)**: 7 Mantine components with shadow defaults in `packages/ui/src/theme.ts` (Card, Paper, Modal, Select, Menu, Notification, Drawer) + the `shadows:{xs..xl}` object those defaults draw from (`theme.ts:109-115`). PLUS: an explicit `<Menu shadow="lg">` override in `apps/admin/src/design-showcase.tsx:558` (missed by initial research — explicit overrides exist), **9** inline `boxShadow` instances in `apps/lms/src/showcase-view.tsx` (not 1 as first counted), and 1 uncounted inline shadow in `apps/lms/src/student-shell.tsx:148`. **~19+ total edit locations.** Also: `docs/design-system.md` scope must include `packages/ui/src/tokens.css` AND `apps/admin/src/design-showcase.tsx`'s live "Shadow Scale" demo (lines 733-748) which binds directly to the CSS vars and will silently drift if left unedited.

## Phases

| # | Phase | Status | File |
|---|---|---|---|
| 1 | Lock current shadow behavior with tests, then remap tokens | pending | [phase-01-shadow-token-remap.md](phase-01-shadow-token-remap.md) |

## Dependencies

- None (first plan in sequence)
- Blocks: P2, P3, P4, P5, P6, P7 (all consume new tokens)

## Acceptance criteria

- `--cmc-shadow-*` decorative values updated to flat/border-only per Zero Elevation doctrine, in BOTH `tokens.css` and `theme.ts` (not just one).
- Functional shadows (dropdown/menu/modal — pending user confirmation, see Unresolved) explicitly preserved, not accidentally zeroed.
- Floating UI (dropdown/menu/modal) remains visually distinguishable from the page behind it after the change (red-team: this was only in phase-01's Success Criteria, promoted here since it's the plan's own #1 stated risk).
- `design-showcase.tsx`'s live Shadow Scale demo reflects the new values (not left stale).
- Pre-change test (locking current `theme.ts` shadow config as a plain object/string assertion — see Phase 1 TDD note) passes before edit, then updated + passes after edit.
- `pnpm -w typecheck` + visual smoke-check on Card/Modal/Menu/Select in running admin app.
- Bucket-B finding **#22** (date input format inconsistent DD/MM/YYYY vs raw YYYY-MM-DD across app) documented as a new rule in `docs/design-system.md` — added by red-team (structural audit), this finding was unassigned to any of the 7 plans; folded in here since P1 already owns `design-system.md` edits this round. This is a documentation task (pick one format, write the rule), not a code change to every date input — those get fixed opportunistically in P4-P7 as each module is touched.

## Decisions (auto-selected recommended default, no user response after 60s wait — flagged for later confirmation, not silently assumed)

1. **RESOLVED (default applied 2026-07-03)**: Card/Paper/Notification → flatten fully (decorative, no depth-cue needed). Modal/Menu/Select/Drawer → **keep** `--cmc-shadow-sm` minimum (functional — these float above other content; without a depth-cue, users can't tell an open dropdown/modal apart from the page on the near-white `#F5F5F7` background).
2. Does "Zero Elevation" apply retroactively to already-shipped Card/Modal usages, or only new components going forward? — Applied retroactively (theme.ts default change is inherently retroactive to every consumer; no per-component opt-out is planned).
2. **RESOLVED**: since Modal keeps its shadow per decision #1, the accessibility/contrast compensation question (increase border-width) is moot — the shadow itself remains the depth-cue, no compensating border change needed. Re-open only if user later decides to flatten Modal too.

**If the user disagrees with either default, revert `theme.ts`'s Modal/Menu/Select/Drawer shadow value before merging this plan — cheap to change while still in Phase 1, expensive after P2-P7 build on top of it.**
