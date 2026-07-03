# Phase 3 — Dashboards & Cockpits — Implementation Report

## Executed Phase
- Phase: phase-03-dashboards-cockpits
- Plan: `D:\project\CMCnew\plans\260703-2351-erp-admin-reskin-core3`
- Status: completed

## Files Modified
- `apps/admin/src/crm-director-dashboard.tsx` (+27/-13 lines)
- `apps/admin/src/revenue-report.tsx` (+42/-19 lines)
- `apps/admin/src/attendance-report-panel.tsx` (+40/-6 lines)

## Files reviewed, zero diff (judgment calls — see below)
- `apps/admin/src/biz-director-cockpit-panel.tsx`
- `apps/admin/src/edu-director-cockpit-panel.tsx`
- `apps/admin/src/overview-panel.tsx`

## Tasks Completed

### `crm-director-dashboard.tsx`
- Imported `InitialsAvatar`, `PipelineFunnel` from `@cmc/ui`.
- Leaderboard `name` column: `render: (r) => r.name` → `render: (r) => <Group><InitialsAvatar
  name={r.name} size="sm" /><Text>{r.name}</Text></Group>`. No column key/sort/width change.
- Pipeline: replaced the flat `SimpleGrid` of 5 `Card`s with `<PipelineFunnel stages={funnel.map(f
  => ({ label: f.stage.label, count: f.count, value: `${f.pct}% tổng pipeline` }))} />`. The
  `funnel` `useMemo` itself (stage/count/pct computation) is byte-identical — only the JSX
  consuming it changed. Confirmed the `loading` ternary inside the old markup was already dead
  code (funnel is `[]` while `opps` is `null`), so dropping it changes nothing observable.
- No `StatusBadge` added here — the leaderboard has no status/tier field in `ConsultantRow`
  (`leads`/`closed`/`won`/`conversionPct`/`avgCycleDays` only); fabricating a tier threshold to get
  a pill would be inventing business logic, out of scope for a styling-only phase.

### `revenue-report.tsx`
- Added a 3-card `StatCard` row (Doanh thu gộp / Hoàn tiền / Doanh thu ròng) directly above the
  existing table, rendered only inside the pre-existing `{load === 'ok' && rows.length > 0 && (...)}`
  branch. Values come from the `totals` object already computed via `rows.reduce(...)` a few lines
  above — no new state, no new query. The table's own "Tổng" row is untouched (kept for parity with
  the per-period breakdown, StatCards are the KPI-glance layer above it).
- Outer `Card` gained `p="lg"` for "organized calm" density.
- No table row/column changes; no `InitialsAvatar`/`StatusBadge` — rows are period labels + VND
  amounts, no person or status field.

### `attendance-report-panel.tsx`
- **Bug check**: audit flagged `--cmc-surface-muted` (undefined token) at ~line 34. Grepped
  `apps/admin/src/**` and `packages/ui/src/tokens.css` for `surface-muted` — zero matches in code
  (only in plan/report docs describing the finding). The file already uses `--cmc-surface-2`
  (confirmed at the `TrendBarChart` bar-track background). **No code change was needed — the bug
  was already fixed in an earlier session.**
- Added `icon`/`accent`/`muted` to the 5 existing `StatCard`s (previously bare `label`/`value`):
  Tổng buổi (`IconCalendarStats`, brand), Có mặt (`IconCircleCheck`, ok), Trễ (`IconClockHour4`,
  warn), Vắng (`IconUserX`, danger), Tỉ lệ chuyên cần (`IconChartBar`, brand, existing
  `delta`/`deltaDir`/`deltaHint` wiring untouched). `muted` mirrors each StatCard's own zero-value
  check (e.g. `result.counts.present === 0`), matching the pattern already used in
  `crm-director-dashboard.tsx`.
- Outer `Card` gained `p="lg"`.
- `TrendBarChart` and the `byClass` drill-down table are unchanged — no person names, no status
  field (class code/name + present/late/absent/total/rate counts only).

## Files reviewed with no changes made (judgment calls)
- **`biz-director-cockpit-panel.tsx` / `edu-director-cockpit-panel.tsx`**: both compose
  `OverviewPanel` + (biz only) `CrmDirectorDashboardCard` + a local `ApprovalInboxCard`. Read in
  full; `ApprovalInboxCard`'s own markup is a `Table` of approval items (`item.title` — a receipt/
  reward/shift-registration/KPI display string, not a person's name) with a per-domain category
  `Badge` (color keyed by `domain`, e.g. receipt=blue, rewards=grape). Two reasons I left these
  unconverted: (1) there's no person-name field to put an `InitialsAvatar` next to — `item.title`
  is the record's own label, not an actor; (2) the domain badge is a **category tag**, not a
  **status** (active/pending/rejected/draft/info) — `StatusBadge`'s tone vocabulary doesn't map
  onto "which approval domain is this", and forcing it through `StatusBadge.map` would require
  inventing a tone-per-domain mapping not implied by any real status field. Both cockpit panels'
  own `Card`s were already `radius="lg" p="lg" withBorder` — already compliant with the "organized
  calm" padding requirement. Net: these two files needed zero changes beyond what the shared
  `CrmDirectorDashboardCard`/`OverviewPanel` components they compose already deliver.
- **`overview-panel.tsx`**: already fully migrated to `StatCard` (6 KPI cards, `loading`/`muted`
  wired identically to the pattern used elsewhere) prior to this phase. The pipeline widget's
  wrapping `Card` was already `radius="lg" p="lg" withBorder`. `StatCard` itself hardcodes `p="lg"`
  internally (`stat-card.tsx` line 65), so the "generous card padding" requirement was already
  satisfied for every KPI block. The pipeline section here is a horizontal progress-bar list
  (different data shape/visual language from `PipelineFunnel`'s chevron stages) and isn't named in
  the phase spec as a `PipelineFunnel` target — left as-is rather than force-fitting a
  differently-shaped component.

## Tests Status
- Type check: pass (`pnpm -w typecheck`, 12/12 packages, cache hits + fresh runs on
  `@cmc/admin`/`@cmc/ui`/`@cmc/api`/`@cmc/lms`).
- ESLint: pass (all 6 files in scope, zero warnings/errors).
- Unit tests: pass (`pnpm --filter @cmc/admin test`, 27/27, 4 test files — no regression in
  nav-consistency / nav-director-kd-cockpit-consolidation / nav-director-dt-cockpit-consolidation /
  nav-teacher-consolidation suites).
- Integration tests: not run (no changed backend/data-flow surface; out of scope for a
  styling-only phase).

## Control-flow verification
Diffed all 3 touched files line-by-line: every existing conditional branch (`{error && ...}`,
`{load === 'ok' && rows.length > 0 && ...}`, `{load === 'ok' && rows.length === 0 && ...}`,
`{load === 'idle' && ...}`, `{load === 'error' && ...}`, the `muted`/`loading`/delta ternaries
inside each `StatCard` call) is present, unchanged, and in the same order before/after. No branch
added or removed — only the JSX rendered *inside* existing branches changed (StatCard props,
PipelineFunnel swap, avatar addition).

## GitNexus
No GitNexus MCP tools were exposed in this session's toolset (only Glob/Grep/Read/Edit/Write/
Bash/WebFetch/WebSearch/Agent/SendMessage were available — no `gitnexus_*` functions). Used
`git status --porcelain` + `git diff` on `apps/admin/src` instead to confirm the diff is scoped to
exactly the 3 files listed above, with no unexpected files touched.

## Issues Encountered
None blocking. One pre-flight surprise: the phase spec's headline bug ("`--cmc-surface-muted` at
attendance-report-panel.tsx:34") does not exist in the current codebase — verified by grep before
touching the file, to avoid "fixing" a line that was already correct.

## Next Steps
- Phase 4 (lists/tables/kanban) can proceed — no shared-file conflicts with this phase's 3 touched
  files.
- If a future pass wants `StatusBadge pill` on the CRM leaderboard or approval-inbox tables, it
  needs a real status/tier field defined first (not fabricated here) — flag to product/plan owner
  if that's desired, since it's a data-shape decision, not a styling one.

Status: DONE
Summary: Restyled crm-director-dashboard.tsx (PipelineFunnel + InitialsAvatar), revenue-report.tsx (StatCard KPI row), attendance-report-panel.tsx (StatCard icons/accents); confirmed the reported --cmc-surface-muted bug was already fixed and biz/edu-cockpit-panel.tsx + overview-panel.tsx already met the Phase 2 bar with zero diff needed. Typecheck/ESLint/tests all green, diff scoped to 3 files with zero control-flow changes.
Concerns/Blockers: GitNexus MCP tools unavailable in this session (used git diff instead — functionally equivalent for this styling-only scope but flagging per project convention). Judgment calls on biz/edu-cockpit-panel.tsx and overview-panel.tsx (no changes) and on skipping StatusBadge where no real status field exists, both documented above — please confirm these read the same way from the plan owner's side.
