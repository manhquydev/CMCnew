---
title: "Plan: Odoo-Parity UX Framework (log + filter + view-modes, system-wide)"
date: 2026-06-29
status: proposed
lane: high-risk
scope: framework-program-phased
intake: 28
inputs:
  - ../reports/researcher-260629-2124-odoo-ux-framework-reusable-primitives-report.md
  - ../reports/brainstorm-260630-0012-odoo-density-mode-design-language-report.md
  - "CMCnew module inventory (Explore agent, evidence-based)"
---

# Plan: Odoo-Parity UX Framework

## Problem (evidence)

CMCnew hand-rolls the same three systems per panel; Odoo gets them for free via framework inheritance. Inventory of 17 admin modules found:

- **Activity log:** only 5 entities wired (`student, receipt, opportunity, after_sale_case, class_batch`). Missing on staff, payslip, facility, meetings, etc.
- **Views:** almost all are tables. KPI has a bespoke kanban. **No calendar anywhere** despite schedule/attendance/meetings being time-based.
- **Filters:** per-panel ad-hoc; the **facility selector is duplicated 8+ times**; no shared filter bar / saved views / defaults.

Odoo model (cited in research report): models inherit `mail.thread` → chatter free; search views declare filters/group-by/defaults; actions declare multiple view types with a **default view**; the framework renders the switcher. Modules add ~10 lines of config, not bespoke code.

## Strategy

Build a small **framework layer** of reusable primitives, then adopt per module — starting with the module in hand, expanding system-wide. Reuse what already exists (`DataTable`, `Chatter`, `PageHeader`, `StatusBadge`, design tokens).

### Primitive set (framework layer)

| Primitive | Type | Purpose |
|---|---|---|
| `<ActivityLog entityType entityId/>` | component | Generic chatter: actor name + friendly field labels + value formatters + event types. Backed by a secure per-entity timeline endpoint (staff precedent). |
| `useFilterBar()` + `<FilterBar/>` | hook+component | Filter state (search, facets, group-by), default filter on open, optional saved view. |
| `useViewSwitcher()` + `<ViewSwitcher/>` | hook+component | Active view (list/kanban/calendar/form) + persisted default per module. |
| `view-defaults.ts` | config | Central registry: default + allowed views per entity. |
| standard list input | tRPC convention | `{ facilityId, skip, take, search?, filters?, groupBy?, sortBy? }` shape reused by list endpoints. |
| `<FacilityPicker/>` | component | Kill the 8× duplicated facility selector. |

### Per-module default view (proposed, from research)

| Entity | Default | Secondary | Notes |
|---|---|---|---|
| CRM opportunity | kanban | list, form | pipeline O1→O5 |
| CRM test appt | calendar | list | time-based |
| finance receipt | list | kanban-by-status | ledger-first |
| schedule session | calendar | list | week default |
| parent meeting | calendar | list | color by status |
| attendance | calendar | list | day picker |
| payslip | list | kanban-by-period | |
| student | list | kanban-by-program, form | |
| staff (org) | form/record | list | done (record page) |

## Phases

| Phase | Risk | Scope |
|---|---|---|
| F0 | — | Commit the in-flight cluster (staff record page + enriched log + U2). Land the current module first. |
| FD | normal | **Density-mode design tokens** → [phase-FD-density-mode-tokens.md](phase-FD-density-mode-tokens.md) (visual language, prereq for F2/F5). Add additive `--cmc-dt-*`/`--cmc-filterbar-*`/`--cmc-form-*`/`--cmc-chip-*` tokens; give `DataTable` a `density` prop (default compact for lists). Borrow Odoo density+hairline+flat for data-views; keep Apple identity (blue, SF, pill CTA, rounded cards). No nav change. See brainstorm report for concrete token map. |
| F1 | normal | Extract framework primitives from the staff page: generic `<ActivityLog>` (+ secure timeline endpoint pattern), `<FacilityPicker>`, `view-defaults.ts`, standard list input shape. No behavior change to existing panels. |
| F2 | normal | `useFilterBar`/`<FilterBar>` + `useViewSwitcher`/`<ViewSwitcher>`; adopt on ONE pilot module end-to-end (CRM: kanban + filter + log already present → ideal pilot). |
| F3 | normal-high | Calendar view primitive; adopt on schedule + meetings + attendance. |
| F4 | normal | Roll log onto remaining detail-capable entities (staff already done; add payslip, facility, meeting) via the generic ActivityLog + per-entity secure endpoint or NOTE_TARGETS where facility-scoped. |
| F5 | normal | System-wide sweep: every list gets FilterBar + ViewSwitcher with its default; remove per-panel duplication. |

Each phase is independently shippable and reviewed. We do NOT build everything at once.

## Key Architectural Decisions (need confirmation)

1. **Calendar library:** Mantine has no full calendar. Options: `@mantine/dates` Calendar (light, custom event layout) vs add a dep (`react-big-calendar` / FullCalendar). Recommend: start with a light custom week/month grid over `@mantine/dates` to avoid a heavy dep; revisit if needed.
2. **Saved filters / default view persistence:** localStorage (per-user, MVP, no backend) vs DB (user-scoped, durable). Recommend: localStorage for F2, DB later if needed.
3. **Kanban interaction:** click-to-change-status (safe, audit-friendly) vs drag-and-drop. Recommend: click/menu first; dnd later.
4. **Log on `user`/`facility`:** keep the SECURE per-entity endpoint pattern (like `staffTimeline`), NOT the open Chatter `NOTE_TARGETS`, for identity entities.

## Success Criteria

- A new module can get log + filter + views by adding config + a few lines, not bespoke code.
- Time-based modules (schedule/meetings/attendance) have a calendar; pipelines (CRM) have kanban; each module opens on a sensible default view.
- Every detail page has a consistent, human-readable activity log (who/what/when).
- No regression; security model (RLS + permission gates) preserved per primitive.

## Out of Scope (now)

- @mention / email notifications in chatter.
- Microsoft Graph G-phases (ADR 0015).
- Full drag-and-drop kanban.

## Open Questions

1. Approve the phased program (F0→F5) and start at F0 (commit) → F1 (primitives) → F2 (CRM pilot)?
2. Confirm the 4 architectural defaults above (calendar-light, localStorage, click-kanban, secure-endpoint-for-identity).
3. Priority order for F3/F4/F5 modules — any business priority (e.g. schedule calendar first)?
