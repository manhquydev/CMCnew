# Phase 3 — Dashboards & cockpits

**Status**: implemented (2026-07-04). Touched only 3 of the 6 listed files —
`crm-director-dashboard.tsx`, `revenue-report.tsx`, `attendance-report-panel.tsx` — after reading
`biz-director-cockpit-panel.tsx`, `edu-director-cockpit-panel.tsx`, `overview-panel.tsx` in full
and confirming each already met the Phase 2 component bar with zero diff needed (judgment calls
below). `crm-director-dashboard.tsx`: leaderboard name cell now renders `InitialsAvatar` +
`Text` (was plain `r.name`); the flat `SimpleGrid` of 5 stage cards replaced with `PipelineFunnel`,
mapping `funnel` (`{stage, count, pct}[]`, `useMemo` computation itself untouched) to
`{label, count, value}[]` at the JSX call site only. `revenue-report.tsx`: added a 3-card
`StatCard` row (gross/refunds/net) above the existing table, driven by the already-computed
`totals` reduce (no new state/query) — table body and its "Tổng" row kept exactly as-is; outer
`Card` gained `p="lg"`. `attendance-report-panel.tsx`: the audit-flagged `--cmc-surface-muted`
bug was **already fixed** in a prior session (grepped both `apps/admin/src` and
`packages/ui/src/tokens.css` — zero occurrences outside plan docs) — no code change needed; added
semantic `icon`/`accent`/`muted` props to the 5 existing `StatCard`s (was bare `label`/`value`
only) and `p="lg"` to the outer `Card`. `pnpm -w typecheck` 12/12 clean, ESLint clean on all 6
files (3 edited + 3 confirmed no-op), `pnpm --filter @cmc/admin test` 27/27 (no regression).
GitNexus MCP tools were not exposed in this session's toolset — `git diff` used instead to confirm
the diff is scoped to exactly 3 files with zero conditional-branch changes (verified line-by-line:
every `{error && ...}`, `{load === 'ok' && ...}`, ternary, ordering untouched — only what renders
inside existing branches changed). Full report:
`plans/260703-2351-erp-admin-reskin-core3/reports/
fullstack-developer-260704-0136-phase-03-dashboards-cockpits-report.md`.

## Context
- Most visually broken group → done first. Wireframe refs: `cockpit_i_u_h_nh_crm` (#3, 4 KPI cards +
  gradient chevron funnel + 36px leaderboard table with initials avatars + tinted status pills) and
  `b_o_c_o_xu_h_ng_i_m_danh_cmc_erp` (#2, 3 KPI cards + bar chart + breakdown table).
- Consumes Phase 2: StatCard (circular accent + arrow), StatusBadge pill, InitialsAvatar,
  PipelineFunnel.
- These files include this-session business work (CRM/attendance/finance) — styling-only edits;
  no handler/query/data-flow change.

## Requirements
- Replace ad-hoc KPI blocks with polished `StatCard` (semantic `accent`, `deltaDir` arrow).
- `crm-director-dashboard.tsx` + `biz-director-cockpit-panel.tsx`: render pipeline as
  `PipelineFunnel` where a flat stage list/kanban is currently shown; leaderboard tables use
  `InitialsAvatar` + `StatusBadge pill`.
- `attendance-report-panel.tsx`: fix the audit's blocking bug — `--cmc-surface-muted` (undefined
  token, line ~34) → `--cmc-surface-2`; apply KPI/table polish.
- `overview-panel`, `revenue-report`, `edu-director-cockpit-panel`: KPI card + table polish; generous
  card padding (`p="lg"`/20px) per "organized calm".

## Files
- Modify: `apps/admin/src/biz-director-cockpit-panel.tsx`, `edu-director-cockpit-panel.tsx`,
  `crm-director-dashboard.tsx`, `overview-panel.tsx`, `revenue-report.tsx`, `attendance-report-panel.tsx`.

## Steps
1. Per file: `gitnexus_impact` on any exported symbol before editing; confirm styling-only scope.
2. Swap KPI markup → `StatCard`; pipeline → `PipelineFunnel`; names → `InitialsAvatar`; statuses →
   `StatusBadge pill`. Fix the `--cmc-surface-muted` token bug.
3. Leave all data fetching, handlers, permission checks, and props untouched.

## Tests / validation
- `pnpm -w typecheck`; existing panel tests (if any) green.
- Playwright: each of the 6 screens vs its wireframe (cockpit/attendance-report have exact refs;
  others judged against Core 3 KPI/table conventions).
- `gitnexus_detect_changes` — only these 6 files; no logic symbols flagged.
- `code-reviewer` pass: explicitly assert no data-flow/handler diff.

## Risks / rollback
- Risk: reskin drops a conditional (loading/empty/permission) branch. Mitigation: reviewer diffs
  JSX control flow; keep skeleton/empty states.
- Risk: PipelineFunnel stage data shape mismatch. Mitigation: map existing stage arrays to funnel
  props in the panel, not in the shared component.
- Rollback: per-file revert; each panel independent.
