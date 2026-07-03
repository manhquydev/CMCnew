# Phase 4 — Lists, tables & kanban

> **Status (batch 1, 2026-07-04): implemented for the 6 explicitly-named files.**
> `crm-panel.tsx`, `students-panel.tsx`, `guardians-panel.tsx`, `finance-panel.tsx`,
> `contact-directory-panel.tsx` restyled (StatusBadge pill, InitialsAvatar, kanban card
> radius/owner polish). `student-management-panel.tsx` confirmed NOT a list/table screen
> (plain `Tabs` wrapper delegating to `Workspace`/`CoursesPanel`/`AssessmentPanel`) — no
> change needed, correctly skipped. `data-table.tsx` untouched — `--cmc-dt-*` density
> tokens and `density="compact"` default already covered the requirement, no shared-file
> gap found. Remaining ~33 other `*-panel.tsx` files using `DataTable`/`<Table` are an
> **intentionally deferred batch 2** (see report
> `reports/fullstack-developer-260704-0150-phase-04-lists-tables-kanban-batch1-report.md`
> for the full list and candidates).

## Context
- Wireframe refs: `template_danh_s_ch_erp_vietnamese_core` (#11 — canonical: 36px dense rows,
  8px 12px cell padding, sticky header, tinted status pills, control bar with facet chips + view
  switch) and `template_kanban_erp_vietnamese_core` (#12 — 4 columns, `rounded-lg` cards, count
  badges, left-accent active column).
- Existing primitives already cover most of this: `data-table.tsx`, `filter-bar.tsx`,
  `view-switcher.tsx`, `status-badge.tsx`. Prefer tuning these over per-panel restyling (DRY).
- `crm-panel.tsx` holds `OppKanban` (SimpleGrid columns) — align to #12 card style; consider
  `PipelineFunnel` as the pipeline overview above the kanban.

## Requirements
- Confirm `DataTable` renders at Core 3 density (row 36px, header 11px uppercase, `--cmc-border`
  hairline) — the density tokens (`--cmc-dt-*`) already exist; ensure list panels opt into
  `density="compact"` where the wireframe is dense.
- Status cells across list panels → `StatusBadge` (pill where wireframe shows tinted pills).
- Owner/person columns → `InitialsAvatar` + name.
- `OppKanban` cards: `rounded-lg` (8px) border cards, active-column left accent, count badge.
- Control bar (search + filter chips + view switch) uses `FilterBar`/`ViewSwitcher` consistently.

## Files
- Modify: `apps/admin/src/crm-panel.tsx`, `students-panel.tsx`, `student-management-panel.tsx`,
  `guardians-panel.tsx`, `finance-panel.tsx`, `contact-directory-panel.tsx`, and other list-style
  `*-panel.tsx` that render a DataTable (enumerate at execution via grep for `DataTable`/`Table`
  usage; batch in groups of ~4 per code-reviewer pass).
- Possibly modify: `packages/ui/src/data-table.tsx` ONLY if a shared density gap is found (would
  re-touch a Phase-2-adjacent shared file — do it in an isolated sub-commit with its own review).

## Steps
1. Grep `apps/admin/src` for `DataTable`/`<Table` to produce the exact panel list (state total count).
2. Per batch: `gitnexus_impact` on any shared column/helper; apply StatusBadge/InitialsAvatar/density.
3. `crm-panel` kanban restyle; keep all filter/query/mutation logic intact.

## Tests / validation
- `pnpm -w typecheck`; `data-table-utils.test.ts` green.
- Playwright: representative list (students/finance) + CRM kanban vs #11/#12.
- `gitnexus_detect_changes` per batch; reviewer confirms styling-only.

## Risks / rollback
- Risk: shared `data-table.tsx` change regresses every table app-wide. Mitigation: isolate that
  edit, screenshot 3 tables across apps (incl. lms if it consumes DataTable — grep first).
- Risk: `density="compact"` clips existing custom cell renderers. Mitigation: verify per panel.
- Rollback: per-batch revert; shared-table edit reverts independently.
