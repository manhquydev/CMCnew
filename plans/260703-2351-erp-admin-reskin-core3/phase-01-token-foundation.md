# Phase 1 — Token foundation (Inter, border, green, radius)

## Context
- Single source of truth: `packages/ui/src/tokens.css` (CSS vars) + `packages/ui/src/theme.ts`
  (Mantine override). Both must change together — the audit report found a prior bug where
  a token existed in one but not the other.
- Spec values from `DESIGN.md` frontmatter/prose. Zero Elevation shadow doctrine is untouched.
- `theme.test.ts` currently locks ONLY shadows (verified) — color/radius changes won't break
  it; add explicit locks for the new values.

## Requirements (exact target values)
- **Font**: `Inter` first, system stack fallback.
  - `tokens.css --cmc-font` → `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif`
  - `theme.ts` `fontFamily` and `headings.fontFamily` → same, Inter-first.
  - Self-host via `@fontsource/inter` (add to `packages/ui` deps); import weights 400/500/600/700
    in `apps/admin/src/main.tsx` ONLY (not lms `main.tsx`). Keeps tokens.css network-free for LMS.
- **Border**: `--cmc-border` `#D2D2D7` → `#E5E7EB`. Leave `--cmc-border-faint` (#E8E8ED) and
  `cmcGray` tuple as-is (gray scale, not the structural stroke).
- **Green (#06C167)**:
  - `--cmc-ok` `#34C759` → `#06C167`; `--cmc-status-active` `#34C759` → `#06C167`.
  - `--cmc-ok-bg` retint to green hue (~`#E6F9F0`); keep `--cmc-ok-text` `#1A6B34` (recheck ≥4.5:1).
  - `theme.ts cmcGreen[5]` `#34C759` → `#06C167` (see plan Decision #2: swap 5/6 + keep far stops
    unless user wants full re-ramp).
- **Card radius ≤8px**:
  - `theme.ts` `Card.defaultProps.radius` and `Paper.defaultProps.radius` `'lg'`(14) → `'sm'`(8).
  - Do NOT resize the radius scale itself (inputs/buttons depend on it). Only Card/Paper default.
  - `stat-card.tsx` explicit `radius="lg"` handled in Phase 2.
- **Button radius 4px** (confirmed 2026-07-04 — literal DESIGN.md spec, not the earlier
  keep-pill default): `theme.ts` `Button.defaultProps.radius` `'xl'` (pill) → `'xs'` (4px).
  Highest-fan-out single change in this phase (every button in the app). Screenshot the
  finance-panel approve/cancel/reconcile action row before/after as the representative
  button-heavy check, in addition to the P0 dashboard screenshot.

## Files
- Modify: `packages/ui/src/tokens.css`, `packages/ui/src/theme.ts`, `packages/ui/src/theme.test.ts`,
  `packages/ui/package.json` (add `@fontsource/inter`), `apps/admin/src/main.tsx` (font import),
  `apps/admin/src/design-showcase.tsx` (any hard-coded #D2D2D7 border / green / 14px card demos).

## Steps
1. `gitnexus_impact({target:'theme', direction:'upstream'})` — confirm blast radius (all 3 apps
   import theme; expected). Warn if HIGH/CRITICAL.
2. Grep LMS for reliance on changed tokens: `--cmc-ok`, `--cmc-status-active`, `--cmc-border`
   under `apps/lms/` — if a kid screen uses them for branding, scope a `.lms-app-root` override
   BEFORE changing global values.
3. Add `@fontsource/inter`; import in `apps/admin/src/main.tsx`.
4. Edit `tokens.css` (font, border, green, ok-bg).
5. Edit `theme.ts` (fontFamily, headings, cmcGreen[5/6], Card/Paper radius).
6. Update `design-showcase.tsx` demos that bind literal old values.
7. Add TDD locks to `theme.test.ts`: `Card/Paper defaultProps.radius === 'sm'`, and a
   fontFamily-starts-with-Inter assertion. (Colors live in CSS vars, not the JS theme object,
   so assert the tuple: `theme.colors.cmcGreen[5] === '#06C167'`.)

## Tests / validation
- `pnpm --filter @cmc/ui test` (theme.test green), `pnpm -w typecheck` clean.
- Playwright (P0): admin dashboard before/after — Inter renders, borders lighter, green shifted.
- **LMS regression**: capture one LMS screen before/after — must be visually identical.

## Risks / rollback
- Risk: Inter FOUT / missing weight. Mitigation: import needed weights explicitly; `font-display: swap`.
- Risk: green re-ramp makes light badges muddy. Mitigation: verify `variant="light"` cmcGreen badges
  in showcase after change.
- Rollback: revert tokens.css + theme.ts + package.json + main.tsx import in one commit; self-contained.
