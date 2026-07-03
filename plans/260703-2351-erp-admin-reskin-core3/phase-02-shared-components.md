# Phase 2 — Shared component layer

**Status**: sub-phases 2a-2e implemented (2026-07-04). 2f (global search backend) explicitly
OUT of scope for this pass — separate agent/review unit. `StatCard` icon chip is now circular
with a semantic `accent` prop and a built-in trend arrow (`IconArrowUpRight`/`IconArrowDownRight`,
none for `flat`); `crm-director-dashboard.tsx`'s `TrendDelta` helper was trimmed to text-only
(11-line diff) so the arrow doesn't double-render — this was the only business file touched, and
only for that one fix. `StatusBadge` gained a backward-compatible `pill?: boolean` (default
false). New `InitialsAvatar` (`avatar-initials.tsx`, deterministic char-code-hash → semantic
palette, `initialsOf`/`colorOf` unit-tested) and `PipelineFunnel` (`pipeline-funnel.tsx`, CSS
`clip-path` chevrons, `color-mix` gradient from pale to full `--cmc-brand`) both export from
`index.tsx` and drop into `design-showcase.tsx` demo sections. `shell.tsx` top-bar gained a
presentation-only search `TextInput` (`visibleFrom="sm"`, no backend call — 2f wires it later),
help + app-grid `ActionIcon`s, and swapped the ad-hoc `me.displayName.slice(0,2)` avatar for
`InitialsAvatar` — additive only, AppShell.Header height and notification/logout logic untouched.
`pnpm --filter @cmc/ui test` (55/55, incl. 9 new avatar-initials tests), `pnpm -w typecheck`
(12/12 packages), ESLint clean on `@cmc/ui`+`@cmc/admin` touched files, `pnpm --filter @cmc/admin
test` (27/27, incl. nav-consistency suites — no shell regression). Visual capture re-run
(`pnpm --filter e2e reskin:capture`, 3/4 — cockpit-crm pre-existingly needs
`STAFF_PASSWORD_LOGIN=true` on the dev api, unrelated to this change) confirms: top-bar
search/help/app-grid render without squeezing the section title at 1280px, `InitialsAvatar`
renders correctly (color+initials) in the account menu, StatCard's chip-shape change is visible
on every screen using it (attendance-report) as flagged — no layout regression. Captures saved to
`apps/e2e/reskin-baseline-phase2/` (copied aside) instead of overwriting the Phase 1 baseline at
the harness's fixed `reskin-baseline/` output path — Phase 1's known process gap, worked around
this time by backing up/restoring the dir around the run. Full report:
`plans/260703-2351-erp-admin-reskin-core3/reports/fullstack-developer-260704-0056-phase-02a-2e-shared-components-report.md`.

## Context
- Existing primitives (verified): `stat-card.tsx` (StatCard), `status-badge.tsx` (StatusBadge),
  `page-header.tsx`, `data-table.tsx`, `record-detail.tsx`, `calendar-view.tsx`. Do NOT duplicate.
- Wireframe polish absent from shipped components: circular semantic KPI icon badge + trend arrow;
  uppercase tinted status pill (dotless); initials avatar; gradient chevron pipeline funnel; top-bar
  search/help/app-grid.
- Barrel export is `packages/ui/src/index.tsx` — new components must be exported there.
- `shell.tsx` already imports `Avatar`, `Menu`, `Popover`, uses `IconBell`; it is high fan-out
  (every admin screen renders inside it) — run `gitnexus_impact` before editing.

## Requirements
### 2a. StatCard polish (`stat-card.tsx`)
- Icon chip: square (`borderRadius:8`, always brand-muted) → **circular** (`borderRadius:'50%'`)
  with a per-card semantic accent. Add prop `accent?: 'brand'|'ok'|'warn'|'danger'` → drives chip
  bg/fg from `--cmc-*`/`--cmc-*-bg` tokens (default `brand`).
- Trend arrow: prepend `IconArrowUpRight`/`IconArrowDownRight`/`IconMinus` to the delta based on
  `deltaDir` (already a prop). Keep DELTA_COLOR mapping.
- Card radius: explicit `radius="lg"` → `radius="sm"` (8px, matches Phase 1 default).

### 2b. StatusBadge pill variant (`status-badge.tsx`)
- Add `pill?: boolean` (default false = current dot+light badge, backward compatible). When true:
  no dot, `textTransform:'uppercase'`, tinted-bg pill (`variant="light"` already tints) matching
  cockpit wireframe ("VƯỢT KPI"/"CẢNH BÁO"). Existing callers unchanged.

### 2c. InitialsAvatar (new `packages/ui/src/avatar-initials.tsx`)
- Props: `name: string`, `size?`, `src?`. Renders Mantine `Avatar` with 1-2 uppercase initials and
  a deterministic color chosen by hashing `name` into the semantic palette (cmc/cmcGreen/cmcAmber/
  cmcRed/cmcGray). Replaces ad-hoc `me.displayName.slice(0,2)` in shell + plain text names in tables.
- Reuse in `shell.tsx` avatar menu.

### 2d. PipelineFunnel (new `packages/ui/src/pipeline-funnel.tsx`)
- Props: `stages: { label: string; count: number; value?: ReactNode; onClick?: () => void }[]`.
- Renders horizontal gradient chevron funnel (CSS `clip-path` polygon per step, blue-50 → brand),
  per wireframe #3/#12. Pure presentation; click passthrough only. Consumed by P3 cockpit/CRM dash
  and optionally P4 CRM pipeline view.

### 2e. Top-bar additions (`shell.tsx`)
- Add to the right `Group` (before bell): a search `TextInput` (IconSearch, placeholder "Tìm
  kiếm…"), a help `ActionIcon` (IconHelp/IconHelpCircle), an app-grid `ActionIcon`
  (IconLayoutGrid/IconApps). Keep bell + avatar. Preserve AppShell.Header height 56px and
  existing notification/logout logic untouched.

### 2f. Global search backend (real, per user decision 2026-07-04 — supersedes the earlier
no-op-affordance default; this sub-phase is NOT presentation-only, review it like any other
backend change)
- New `apps/api/src/routers/search.ts`: single `global` query, input `{ q: string, facilityId?:
  number }`, output grouped by entity type. Debounce client-side (300ms), min 2 chars.
- Scope confirmed: students (name / studentCode / guardian phone), CRM opportunities (contact
  name / phone), staff (name / email), class batches (code / name). Facility-scoped via existing
  `withRls`/`rlsContextOf` pattern — do not bypass RLS for a "convenience" global search.
- Per-entity result limit (e.g. 5) to keep the dropdown scannable; a "see all results" link is
  out of scope for this pass (YAGNI) unless trivial.
- Frontend: search `TextInput` in 2e opens a result dropdown grouped by entity type; selecting a
  result navigates to that record's existing detail route (reuse existing routes, no new pages).
- Needs its own `gitnexus_impact`/`gitnexus_detect_changes` pass separate from the styling diffs
  in this phase, and its own code-reviewer attention to the query (RLS correctness, no N+1,
  input validation) — do not let it get rubber-stamped alongside CSS-only changes.

## Files
- Modify: `packages/ui/src/stat-card.tsx`, `status-badge.tsx`, `index.tsx`, `apps/admin/src/shell.tsx`.
- Create: `packages/ui/src/avatar-initials.tsx`, `packages/ui/src/pipeline-funnel.tsx`,
  `apps/api/src/routers/search.ts` (2f only — backend, not a `packages/ui` presentation file).

## Steps
1. `gitnexus_impact` on `StatCard`, `StatusBadge`, `Shell` (upstream) — record blast radius; warn if HIGH.
2. Build 2a-2d additively (new props default to current behavior; new files pure).
3. Export new components from `index.tsx`.
4. Edit `shell.tsx` top-bar (additive only); swap its inline avatar for `InitialsAvatar`.
5. Add render smoke tests where a sibling `*.test.ts` pattern exists (e.g. mirror `record-detail.test.ts`).

## Tests / validation
- `pnpm --filter @cmc/ui test` + `pnpm -w typecheck`.
- Add new components to `design-showcase.tsx` and screenshot vs wireframe crops (KPI card,
  status pill, funnel, top-bar).
- Verify existing StatCard/StatusBadge callers still compile with default props (no visual regression
  on screens not yet in a later phase).

## Risks / rollback
- Risk: `shell.tsx` layout shift squeezes section title on narrow widths. Mitigation: search input
  `hiddenFrom` small breakpoint; screenshot 3 screens at 1280/1024.
- Risk: new props accidentally change default rendering. Mitigation: defaults preserve current output;
  reviewer diffs a screen that consumes StatCard/StatusBadge but isn't otherwise touched.
- Rollback: new files deletable; component edits are additive props — revert per file.
