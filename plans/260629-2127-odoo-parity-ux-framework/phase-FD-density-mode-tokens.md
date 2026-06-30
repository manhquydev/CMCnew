---
phase: FD
title: "Density-mode design tokens"
status: completed
priority: P1
dependencies: []
blocks: [F2, F5]
---

# Phase FD: Density-mode design tokens

## Overview
Add an **additive** visual-density layer (Odoo-grade data density) to the shared UI
package without mutating any existing token, so dashboards/cards keep the Apple-minimal
identity while lists/forms gain Odoo-style scan density. Ships the token map + a `density`
prop on `DataTable`. Pure visual; no nav change, no behavior change. Prereq for F2
(FilterBar/ViewSwitcher) and F5 (system-wide sweep), which consume these tokens.

Source design: `plans/reports/brainstorm-260630-0012-odoo-density-mode-design-language-report.md`.

## Requirements
- Functional:
  - New CSS token groups in `packages/ui/src/tokens.css`: `--cmc-dt-*` (table density),
    `--cmc-filterbar-*` + `--cmc-chip-*` (control bar, used by F2), `--cmc-form-*` (record-page grid).
  - `DataTable` gains `density?: 'comfortable' | 'compact'`, **default `'compact'`** (list views are the common case).
  - `density="compact"` → tighter row/cell spacing, 13px cells, hairline dividers, square cells, flat (no card shadow), uppercase 11px header.
  - `density="comfortable"` → current look exactly (no regression for any existing caller that opts in).
- Non-functional:
  - Zero change to existing tokens → dashboards/KPI/overview/cards visually identical.
  - All density values are tokens; no magic numbers in `data-table.tsx`.
  - Compact only applies ≥ `sm` breakpoint; below `sm` fall back to comfortable spacing (touch targets).

## Architecture
- **Token layer (single source):** append new groups to `tokens.css` under a documented header
  block. Identity tokens (brand blue, font, radius, shadow, spacing 5–8) untouched.
- **DataTable consumption:** map the `density` prop to Mantine `<Table>` props +
  inline styles driven by the tokens:
  - `verticalSpacing` / `horizontalSpacing` ← `--cmc-dt-cell-py` / `--cmc-dt-cell-px`
  - `fz` ← `--cmc-dt-font`
  - header `<Table.Th>` styling ← `--cmc-dt-header-*`
  - wrapping `<Card>` drops `shadow`/keeps border-only + `--cmc-dt-radius` when compact
  - row hover/selected/divider colors ← `--cmc-dt-row-hover` / `--cmc-dt-row-selected` / `--cmc-dt-divider`
- **FilterBar/form tokens:** defined now, consumed later (F2 / record-page work). Defining
  them here keeps the visual contract in one commit and unblocks F2 styling.
- **Identity guardrails (DO NOT touch):** `--cmc-brand*`, `--cmc-font*`, `--cmc-radius*`
  (card/CTA), `--cmc-shadow-sm/md` on cards, `--cmc-space-5..8` section spacing, white topbar.

## Related Code Files
- Modify: `packages/ui/src/tokens.css` — append `--cmc-dt-*`, `--cmc-filterbar-*`, `--cmc-chip-*`, `--cmc-form-*` groups.
- Modify: `packages/ui/src/data-table.tsx` — add `density` prop, thread to `<Table>`/`<Card>`/`<Table.Th>`.
- Verify-only (no edit this phase): `apps/admin/src/*-panel.tsx` callers of `DataTable` (default flips to compact — confirm acceptable per panel; opt back to `comfortable` if any panel needs it).
- Consumed later (not edited here): future `FilterBar`/`ViewSwitcher` (F2), `staff-profile.tsx` / `opportunity-detail.tsx` form grid.

## Implementation Steps
1. **Tokens** — append to `tokens.css` (values from brainstorm report token map):
   ```css
   /* ─── Data-view density (opt-in via DataTable density="compact"; FilterBar; form grid).
      Additive only — does NOT alter identity tokens above. ─────────────────────── */
   --cmc-dt-cell-py:      7px;
   --cmc-dt-cell-px:      10px;
   --cmc-dt-font:         var(--cmc-text-sm);     /* 13px */
   --cmc-dt-radius:       6px;
   --cmc-dt-divider:      var(--cmc-border-faint);
   --cmc-dt-header-bg:    var(--cmc-surface-2);
   --cmc-dt-header-font:  var(--cmc-text-xs);     /* 11px */
   --cmc-dt-header-ls:    0.04em;
   --cmc-dt-header-color: var(--cmc-text-muted);
   --cmc-dt-row-hover:    var(--cmc-bg);
   --cmc-dt-row-selected: var(--cmc-brand-muted);

   --cmc-filterbar-h:     44px;
   --cmc-chip-bg:         var(--cmc-brand-muted);
   --cmc-chip-text:       var(--cmc-brand-ink);
   --cmc-chip-radius:     var(--cmc-radius-sm);   /* 8px */
   --cmc-chip-font:       var(--cmc-text-xs);

   --cmc-form-label-w:    160px;
   --cmc-form-label-font: var(--cmc-text-sm);
   --cmc-form-label-color:var(--cmc-text-muted);
   --cmc-form-row-gap:    10px;
   --cmc-form-group-title:var(--cmc-text-md);
   --cmc-notebook-active: var(--cmc-brand);
   --cmc-chatter-w:       340px;
   ```
2. **DataTable prop** — add `density?: 'comfortable' | 'compact'` to `DataTableProps`, default `'compact'`.
   Derive `const compact = density === 'compact'` (guard with a `useMediaQuery('(min-width: 48em)')` so < sm forces comfortable).
3. **Apply to `<Table>`** — when compact: `verticalSpacing={7} horizontalSpacing={10} fz="var(--cmc-dt-font)"`;
   keep `striped highlightOnHover`. When comfortable: leave current props (no spacing/fz overrides).
4. **Header styling** — when compact, give `<Table.Th>` `style` with `backgroundColor: var(--cmc-dt-header-bg)`,
   `fontSize: var(--cmc-dt-header-font)`, `textTransform: 'uppercase'`, `letterSpacing: var(--cmc-dt-header-ls)`,
   `color: var(--cmc-dt-header-color)`, `fontWeight: 600`. (Merge with existing width/align/cursor style.)
5. **Card wrapper** — when compact, set wrapping `<Card>` `radius={6}` and ensure no shadow (already `withBorder`,
   no shadow set — confirm). When comfortable, unchanged.
6. **Row colors** — apply `--cmc-dt-divider` as bottom border + `--cmc-dt-row-selected` if a future `selected`
   flag exists (none today → skip; just wire hover via existing `highlightOnHover`).
7. **Smoke-render** one admin list panel (e.g. `students-panel.tsx`) to confirm compact reads correctly and the
   default flip is acceptable; if any panel looks cramped, pass `density="comfortable"` there explicitly.

## Success Criteria
- [x] `tokens.css` has the 4 new token groups; **no existing token value changed** (`git diff` = 33 insertions, 0 removals).
- [x] `DataTable` accepts `density`, defaults to `compact`, and `comfortable` renders byte-for-byte like today (reviewer-confirmed: overrides resolve to `undefined` when `!compact`).
- [ ] A compact list shows ~30% more rows per screen vs comfortable (visual check pending — verify in running app).
- [x] Below `sm` breakpoint (48em), compact tables fall back to comfortable spacing.
- [x] Dashboards/overview/KPI/cards show **no visual change** (no identity token touched; non-DataTable surfaces unaffected).
- [x] `pnpm --filter @cmc/admin typecheck` green.
- [x] `pnpm --filter @cmc/admin build` green.
- [x] No new lint errors in `packages/ui`.

## Review notes (code-reviewer, DONE)
- Mantine CSS-var override (`--table-vertical-spacing`/`--table-horizontal-spacing`) verified against resolved Mantine 7.17.8.
- Only 2 `DataTable` callers (crm-panel, students-panel; admin-only); both safe under compact spacing.
- Applied review fixes: tokenized header font-weight (`--cmc-weight-semibold`); skeleton header now shares `compactHeaderStyle` (no load-time style pop).
- Staged-but-unconsumed tokens (`--cmc-filterbar-*`, `--cmc-chip-*`, `--cmc-form-*`) kept intentionally for F2/FD-followups; prune if those phases slip.

## Risk Assessment
- **Default-compact flips every existing list at once** → could surprise. Mitigation: it's a visual-only
  change; per-panel opt-out via `density="comfortable"`; smoke-render before commit; reviewable in one `git diff`.
- **Mobile cramping** → mitigated by the `sm` breakpoint fallback (step 2).
- **Token sprawl** → mitigated: grouped under one documented header block; names namespaced (`--cmc-dt-`,
  `--cmc-filterbar-`, `--cmc-chip-`, `--cmc-form-`).
- **Rollback:** additive — revert the two files; no data/schema/contract impact.
