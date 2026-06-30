---
title: "Brainstorm: Odoo design-language → CMCnew density-mode tokens"
date: 2026-06-30
type: brainstorm-report
scope: design-language (visual only; nav model unchanged)
decisions:
  - "Keep 1-tier grouped sidebar (no Odoo two-tier nav)."
  - "Hybrid density mode: borrow Odoo density+chrome for data-views; keep Apple identity (palette/font/brand radius)."
  - "Concrete token map; folds into plan 260629-2127-odoo-parity-ux-framework."
inputs:
  - "D:/Downloads/odoo/*.png (6 screenshots of legacy Teky Odoo Enterprise)"
  - packages/ui/src/tokens.css
  - apps/admin/src/shell.tsx
  - plans/260629-2127-odoo-parity-ux-framework/plan.md
  - plans/reports/researcher-260629-2124-odoo-ux-framework-reusable-primitives-report.md
---

# Odoo design-language → CMCnew density-mode tokens

## Problem
User supplied 6 screenshots of the **legacy Teky Odoo** to mine its layout/interface.
~80% of the *functional* patterns (chatter, control-bar, view-switcher, form view,
CRM record page) are already planned (odoo-parity F0–F5, crm-form-view, staff-record).
The open gap is **visual language**: Odoo is dense/enterprise/sharp; CMCnew tokens are
Apple-minimal/spacious/rounded. The two philosophies conflict and cannot both be adopted wholesale.

## Decision (user-confirmed)
- **Scope = design-language only.** Nav stays 1-tier grouped sidebar (`shell.tsx` unchanged).
- **Hybrid "density mode"** (Approach 2): a separate token layer scoped to *data-views*
  (tables, filter bar, form field grid). Keep CMCnew's Apple identity everywhere else
  (brand blue, SF font, pill CTA, rounded cards, soft dashboard spacing).
- Rationale: Odoo density wins on large lists (sessions/faculty/students — power-user scan);
  Apple-minimal wins on forms/dashboards/KPI. Borrow density where it pays, keep brand where it matters.

## Odoo visual language extracted (from screenshots)
| Axis | Odoo (Teky) | Borrow? |
|---|---|---|
| Top bar | solid teal, full-width, white app name | No (keep white bar = identity) |
| Table density | row ~32px, 1px hairline divider, 8–14 cols, 13px | **Yes** (data-views) |
| Corner radius | sharp ~0–3px on table/input/button | **Partial** (data-views only: 4–6px) |
| Elevation | flat, divider-only | **Yes** (data-views: drop card shadow) |
| Control bar | search + facet chips + Filters/Group By/Favorites + pager + view switcher | **Yes** (= F2) |
| Form view | 2-col, small label + underline input, notebook tabs, chatter right | **Yes** (form grid tokens) |
| Buttons | flat filled, sharp | No (keep pill CTA = identity) |
| Palette | teal + cold grey | No (keep Apple blue + warm grey) |

## Concrete token map (additive — new tokens, do not mutate existing)
Add to `packages/ui/src/tokens.css` under a `[data-density="compact"]` scope (or a
`--cmc-dt-*` group consumed by DataTable/FilterBar/form-grid). Existing tokens untouched
→ zero regression on dashboards/cards.

### 1. Data-table density (`DataTable`, `packages/ui/src/data-table.tsx`)
```css
--cmc-dt-row-h:        36px;                 /* was ~48px via space-3 padding */
--cmc-dt-cell-py:      7px;                  /* vs --cmc-space-3 (12px)        */
--cmc-dt-cell-px:      10px;
--cmc-dt-font:         var(--cmc-text-sm);   /* 13px                           */
--cmc-dt-radius:       6px;                   /* container; cells square         */
--cmc-dt-divider:      var(--cmc-border-faint);   /* #E8E8ED hairline 1px      */
--cmc-dt-header-bg:    var(--cmc-surface-2);      /* #F9F9FB                   */
--cmc-dt-header-font:  var(--cmc-text-xs);        /* 11px                      */
--cmc-dt-header-tt:    uppercase;
--cmc-dt-header-ls:    0.04em;
--cmc-dt-header-fw:    var(--cmc-weight-semibold);/* 600                       */
--cmc-dt-header-color: var(--cmc-text-muted);
--cmc-dt-row-hover:    var(--cmc-bg);             /* #F5F5F7                   */
--cmc-dt-row-selected: var(--cmc-brand-muted);    /* #E8F1FC                   */
--cmc-dt-shadow:       var(--cmc-shadow-none);    /* flat, divider-only        */
```
Result: same Apple palette, Odoo information density. ~30% more rows per screen.

### 2. Control bar / FilterBar (new, = odoo-parity F2)
```css
--cmc-filterbar-h:     44px;
--cmc-chip-bg:         var(--cmc-brand-muted);    /* facet chip "This Week ✕"  */
--cmc-chip-text:       var(--cmc-brand-ink);
--cmc-chip-radius:     var(--cmc-radius-sm);       /* 8px (not pill — Odoo-ish) */
--cmc-chip-font:       var(--cmc-text-xs);         /* 11–12px                   */
--cmc-pager-font:      var(--cmc-text-sm);         /* "1-80 / 4512" muted       */
```
Layout: `[search + chips] ........ [Filters ▾] [Group By ▾] [Favorites ▾] [pager ‹ ›] [view switcher]`.
View switcher = Mantine `SegmentedControl` of icons (list/kanban/calendar), driven by `view-defaults.ts`.

### 3. Form-view grid (record pages: staff/opportunity/...)
```css
--cmc-form-label-w:    160px;                      /* label column width        */
--cmc-form-label-font: var(--cmc-text-sm);         /* 13px                      */
--cmc-form-label-color:var(--cmc-text-muted);
--cmc-form-row-gap:    10px;
--cmc-form-group-title:var(--cmc-text-md);         /* section heading 17px/600  */
--cmc-notebook-active: var(--cmc-brand);           /* underline active tab      */
--cmc-chatter-w:       340px;                       /* right-rail timeline       */
```
Layout: 2-col `label | value` groups + Mantine `Tabs` notebook + right chatter (`<ActivityLog>`).

## Identity guardrails (DO NOT change — keeps CMCnew ≠ Odoo clone)
- Brand blue `#0071E3`, warm grey bg `#F5F5F7`, white top bar.
- SF/system font; pill-radius primary CTA buttons; card radius 14px; soft shadows on cards/modals.
- Dashboard/KPI/overview spacing stays generous (space-5..8).

## Where applied (touchpoints)
- `packages/ui/src/tokens.css` — add `--cmc-dt-*`, `--cmc-filterbar-*`, `--cmc-form-*`, `--cmc-chip-*`.
- `packages/ui/src/data-table.tsx` — consume density tokens (gated by a `density?: 'comfortable' | 'compact'` prop; default compact for list views).
- New `FilterBar` / `ViewSwitcher` (odoo-parity F2) — consume control-bar tokens.
- Record pages (`staff-profile.tsx`, `opportunity-detail.tsx`) — form-grid tokens.

## Approaches considered
1. Control-bar only, no token change — safe, but lists keep wasting space. Rejected (under-delivers).
2. **Hybrid density mode (chosen)** — density+chrome on data-views, Apple identity elsewhere. KISS, additive, low risk.
3. Token redefinition toward Odoo — cold grey bg, colored top bar, sharp corners system-wide. Rejected (destroys Apple identity, hits all 3 apps, high risk).

## Success criteria
- List views show ~30% more rows; tables read as dense/scannable like Odoo.
- Dashboards/forms keep the current Apple feel (no visual regression).
- All density values live as tokens (no magic numbers in components).
- `DataTable` density prop opt-in; existing comfortable usages unaffected.

## Risks
- Density too aggressive → cramped on mobile. Mitigate: compact only ≥sm breakpoint; comfortable on mobile.
- Token sprawl. Mitigate: scope under `--cmc-dt-*`/`--cmc-form-*` groups, documented in tokens.css header.

## Open questions
1. Density default per view: compact for *all* lists, or opt-in per panel?
2. Mobile: force comfortable below `sm`, or just larger tap targets?
3. Notebook tabs vs accordion on record pages for narrow screens?
