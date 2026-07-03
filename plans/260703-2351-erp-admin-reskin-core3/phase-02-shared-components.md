# Phase 2 — Shared component layer

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
