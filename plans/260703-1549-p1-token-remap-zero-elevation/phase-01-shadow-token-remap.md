# Phase 1 — Lock current shadow behavior, then remap to Zero Elevation

**Lane**: TDD (Zero Elevation changes production Card/Modal/Menu/Select rendering — lock behavior before editing)

## Context links

- `plans/260703-1543-erp-ui-rebuild-phase-ab-token-primitives/reports/researcher-260703-1549-shadow-blast-radius-report.md` — initial estimate (undercounted, see below)
- `reports/code-reviewer-260703-1557-shadow-remap-plan-red-team-plan-review-report.md` — red-team correction, use THIS for real file:line locations
- `docs/design-system.md` — Elevation section (current shadow doctrine)
- `plans/reports/brainstorm-260703-1549-erp-ui-rebuild-7-plan-decomposition-report.md` — decision context

## Pre-step (red-team finding, blocking)

Current branch has uncommitted `packages/ui/src/facility-picker.tsx` and `apps/admin/src/meetings-panel.tsx` diffs from prior sessions. Run `git status --short`, commit or explicitly fold these in before touching `theme.ts` — do not let this plan's diff get tangled with unrelated pending work.

## Current code shape (red-team corrected — do not use the original research's "~12 locations, 1 stray shadow" estimate)

- `packages/ui/src/theme.ts` — 7 components with inline `defaultProps: { shadow: ... }`: Card, Paper, Modal, Select, Menu, Notification, Drawer, PLUS the underlying `shadows:{xs..xl}` object (`theme.ts:109-115`) those defaults read from.
- `apps/admin/src/design-showcase.tsx:558` — explicit `<Menu shadow="lg">` override (missed by initial research — confirms explicit shadow= overrides exist beyond theme defaults, must grep for more before assuming theme.ts is exhaustive).
- `apps/admin/src/design-showcase.tsx:733-748` — live "Shadow Scale" demo bound directly to the CSS vars; will silently show stale values if `tokens.css` changes without updating this.
- `apps/lms/src/showcase-view.tsx` — **9** inline `boxShadow` instances (not 1 as originally counted) — re-grep the whole file, don't assume just the cloud-circle one.
- `apps/lms/src/student-shell.tsx:148` — 1 more inline shadow, uncounted in original research.
- `packages/ui/src/tokens.css` — the actual `--cmc-shadow-*` CSS custom property definitions. **Original phase file never listed this as an edit target despite plan.md promising it** — this file IS in scope.
- `docs/design-system.md` — Elevation token table (`--cmc-shadow-none/xs/sm/md/lg/xl`) and their prescribed usage.

**Before starting implementation, grep fresh for `boxShadow`, `shadow=`, `withShadow` across `apps/admin/src`, `apps/lms/src`, `packages/ui/src` — do not trust either research report's location list as exhaustive; both undercounted on the first pass.**

## TDD approach — corrected (red-team finding: original approach not achievable)

**Original plan said "Vitest + Testing Library or Storybook" — this infra does NOT exist.** Verified: `packages/ui/vitest.config.ts` uses `environment: 'node'`, includes only `src/**/*.test.ts` (not `.tsx`), and `packages/ui/package.json` has no `@testing-library/react` or jsdom dependency. Setting up component-render testing infra is out of scope for this plan (would be its own plan).

**Correct approach**: write a plain object/string assertion test against the EXPORTED `theme` config object from `theme.ts` (e.g. `expect(theme.components.Card.defaultProps.shadow).toBe(...)`). This needs zero new infra, fits the existing `.test.ts` pattern, and still achieves the TDD goal (lock current values, prove the edit is deliberate).

## Implementation steps

1. **Lock current behavior**: write `packages/ui/src/theme.test.ts` (or extend an existing test file) asserting the CURRENT `shadow` value for all 7 `theme.ts` component defaults + the `shadows` object values, as plain object assertions — not component render tests. Must pass before any edit.
2. Get explicit user confirmation on Unresolved Question #1 (functional vs decorative split) AND Unresolved Question #3 (Modal accessibility/contrast) from `plan.md` before editing — do not guess.
3. Edit `packages/ui/src/tokens.css`: update `--cmc-shadow-*` CSS custom properties per the confirmed decision.
4. Edit `packages/ui/src/theme.ts`: update `defaultProps.shadow` for all 7 components + the `shadows` object, consistent with step 3's token values.
5. Fix the explicit `<Menu shadow="lg">` override in `design-showcase.tsx:558` and re-grep for any other explicit `shadow=` overrides found in the fresh grep above.
6. Update `docs/design-system.md` Elevation section to document the new doctrine — this becomes the reference for P2-P7.
7. Update `design-showcase.tsx`'s Shadow Scale demo (lines 733-748) to reflect new values, so it doesn't silently drift stale.
8. Fix the 9 inline shadows in `showcase-view.tsx` and the 1 in `student-shell.tsx` if decorative (verify each — don't assume all 9 are safe to zero without checking).
9. Update the locked test from step 1 to assert the NEW values — must pass after edit.

## Todo list

- [ ] Reconcile pre-existing uncommitted diffs (facility-picker.tsx, meetings-panel.tsx) before starting
- [ ] Fresh grep for boxShadow/shadow=/withShadow across admin+lms+ui (don't trust prior counts)
- [ ] Write baseline `theme.test.ts` (object assertions, 7 components + shadows object)
- [ ] Confirm functional-vs-decorative split + Modal accessibility question with user
- [ ] Edit tokens.css
- [ ] Edit theme.ts (7 components + shadows object)
- [ ] Fix design-showcase.tsx Menu override + any other explicit overrides found
- [ ] Update design-system.md Elevation section
- [ ] Update design-showcase.tsx Shadow Scale demo
- [ ] Fix showcase-view.tsx (9 instances, verify each) + student-shell.tsx (1 instance)
- [ ] Update test to new values, confirm passes
- [ ] `pnpm -w typecheck` clean
- [ ] Visual smoke-check: open admin app, verify Card/Modal/Menu/Select render as expected (no broken floating-layer visibility)

## Success criteria

- All 7 theme.ts shadow defaults + tokens.css values updated per confirmed doctrine, consistently (not just one file).
- Locked test passes both before (baseline) and after (new values).
- No visual regression on floating UI (dropdowns/modals still visually separate from page content).
- design-system.md + design-showcase.tsx demo both reflect the new doctrine (no stale reference).

## Risk assessment

- **Main risk**: zeroing shadow on Menu/Select/Drawer could make floating UI indistinguishable from the page behind it if not compensated with border/backdrop. Mitigate: keep at minimum `--cmc-shadow-sm` or add `border` on these specifically if user confirms full-flat.
- **Blast radius corrected from LOW to MODERATE**: ~19+ edit locations across 6 files (not 1 file, ~12 locations as first estimated) — still not high-risk, but plan the extra hour of effort.
- Positive finding (red-team confirmed): no regression risk from the already-shipped Modal-ize work (commit `2bb1ad5`) — spot-checked `crm-panel.tsx`'s Modal usage, no explicit shadow override, inherits theme cleanly.

## Next steps

P2 (record-detail primitive) and P3 (calendar-view primitive) can start once this lands — both new components will use the finalized Elevation doctrine from the start.
