---
title: "ERP admin re-skin to Vietnamese Enterprise Core 3 wireframe fidelity"
description: "Corrective, phased re-skin of the admin app (tokens + shared components + ~40 screens) to match the approved Core 3 wireframe spec — presentation only, no business-logic change."
status: implemented
priority: P2
effort: 5-7d (actual: 1 session, all 8 phases)
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [ux, design-system, ui-reskin, admin, wireframe-fidelity]
created: 2026-07-03
---

## Overview

An earlier P1-P7 rebuild (shipped, committed same day, `plans/260703-1549-p1-token-remap-zero-elevation/`
through `p7-reskin-list-kanban-templates/`, all `status: implemented`) chose "Vietnamese
Enterprise Core 3" as the target style but the implemented tokens/components measurably
diverge from the authoritative spec
`D:\Downloads\stitch_cmcnew\stitch_cmcnew\vietnamese_enterprise_core_3\DESIGN.md`.
This plan is **corrective/additive** on top of that work — it re-aligns token *values*
and adds the missing component polish, then applies both across the admin app. It does
NOT redo the Zero Elevation doctrine (kept as-is) and does NOT touch business logic.

**Reconciliation with the prior P1-P7 plans (verified by reading their code, not just
their status field)**: P1's "token remap" was scoped to shadow/elevation ONLY — it never
touched font-family, border color, green hue, or radius, so Phase 1 here is genuinely
unaddressed ground, not a redo. P4 already built a real `CrmDirectorDashboardCard`
(`apps/admin/src/crm-director-dashboard.tsx`) consuming `StatCard` with working icon +
trend-delta infrastructure — `packages/ui/src/stat-card.tsx` already has an icon chip and
`DELTA_COLOR` semantic coloring on the delta text. Phase 2a is an **incremental upgrade**
of that existing component (square brand-only chip → circular semantic-accent chip, delta
arrow built into the component instead of caller-supplied), not a rebuild. P4's pipeline
funnel is currently a flat `SimpleGrid` of cards (not the wireframe's gradient chevron) —
Phase 2d's `PipelineFunnel` must match that exact data shape (`{stage, count, pct}`) so
`CrmDirectorDashboardCard` can swap to it as a drop-in, not a parallel implementation.
Phase 3 must re-verify each dashboard/cockpit screen fresh (logged in as the correct role —
`biz-director-cockpit-panel.tsx` only renders for single-role `giam_doc_kinh_doanh`
accounts, not `super_admin`, which routes to a plain `overview-panel.tsx` instead per
`App.tsx`'s `isSuperAdmin` bypass) before assuming a screen needs the full treatment.

Source of truth for token VALUES = `DESIGN.md` (its screenshot comparison is what the
user validated). Source of truth for component COMPOSITION/layout = the wireframe
`code.html` files, specifically the `*_vietnamese_core` variant of each template
(record-detail #9, list #11, calendar #14, kanban #12, cockpit #3) — these carry the
8px radius + enterprise density that matches the DESIGN.md prose. See
`plans/reports/planner-260703-2351-erp-admin-reskin-core3-report.md` (this session's
scouting) for the per-wireframe variant selection rationale.

Scope confirmed by user via AskUserQuestion: **full re-skin** (not token-only / sample).
LMS (`apps/lms`) is explicitly OUT of scope (kid-friendly Fredoka/Quicksand theme,
scoped via `.lms-app-root` — must stay untouched).

## Measured divergences to correct (from direct screenshot comparison)

| Aspect | Spec (DESIGN.md) | Shipped | Location |
|---|---|---|---|
| Font | Inter exclusively | system stack, no Inter | `tokens.css --cmc-font`, `theme.ts fontFamily/headings` |
| Structural border | `#E5E7EB` | `#D2D2D7` | `tokens.css --cmc-border` |
| Success/green | `#06C167` | `#34C759` (iOS) | `tokens.css --cmc-ok/--cmc-status-active`, `theme.ts cmcGreen[5]` |
| Card radius | `rounded-lg` 8px, max 8px | 14px (`Card radius:'lg'`) | `theme.ts Card/Paper defaultProps`, `stat-card.tsx` |
| KPI card | circular semantic icon badge + trend arrow | square brand-muted chip, no arrow | `stat-card.tsx` |
| Status | uppercase tinted pill | dot + light badge | `status-badge.tsx` |
| Avatars | initials circle, colored | plain text names | none — new `InitialsAvatar` |
| CRM pipeline | gradient chevron funnel | flat kanban board | `crm-panel.tsx`, `crm-director-dashboard.tsx` |
| Top bar | search + bell + help + app-grid | bell + avatar only | `shell.tsx` |
| Density | "organized calm" generous card padding | tighter | per-screen padding |

## Phases (sequential — later phases consume earlier outputs; no parallel file ownership overlap)

| # | Phase | Owns (files) | Status | File |
|---|---|---|---|---|
| 0 | Visual-verification harness | `apps/e2e/*` (new spec + wireframe refs) | implemented | [phase-00-visual-verification-harness.md](phase-00-visual-verification-harness.md) |
| 1 | Token foundation (Inter, border, green, radius) | `tokens.css`, `theme.ts`, `theme.test.ts`, `design-showcase.tsx`, `admin/main.tsx`, `ui/package.json` | implemented | [phase-01-token-foundation.md](phase-01-token-foundation.md) |
| 2 | Shared component layer (+ 2f search backend) | `stat-card.tsx`, `status-badge.tsx`, `avatar-initials.tsx`, `pipeline-funnel.tsx`, `shell.tsx`, `index.tsx`, `search.ts` | implemented | [phase-02-shared-components.md](phase-02-shared-components.md) |
| 3 | Dashboards & cockpits | `crm-director-dashboard`, `revenue-report`, `attendance-report-panel` (3 others verified already-compliant, zero diff needed) | implemented | [phase-03-dashboards-cockpits.md](phase-03-dashboards-cockpits.md) |
| 4 | Lists, tables & kanban — all 3 batches | 34 of 39 grep-identified `*-panel.tsx` files restyled; 5 confirmed inapplicable (`student-management-panel`, `compensation-panel`, `checkin-panel`, `courses-panel`, `shift-config-panel` — no person-name/status column) | implemented (complete, all batches) | [phase-04-lists-tables-kanban.md](phase-04-lists-tables-kanban.md) |
| 5 | Detail / record pages | `record-detail.tsx` (primitive), `staff-profile`, `student-detail`, `opportunity-detail`, `schedule-detail`, `profile-settings-panel` | implemented | [phase-05-detail-record-pages.md](phase-05-detail-record-pages.md) |
| 6 | Calendar / schedule | `calendar-view.tsx` (primitive), `meetings-panel`, `attendance-panel` (`schedule-panel` has no CalendarView usage — plan assumption was wrong, applied in-scope StatusBadge swap only) | implemented | [phase-06-calendar-schedule.md](phase-06-calendar-schedule.md) |
| 7 | Login | `login-gate.tsx` | verified, zero diff needed (already inherits all Phase-1 tokens correctly) | [phase-07-login.md](phase-07-login.md) |

## Dependencies

- P0 → independent (harness); should land first so every later phase can screenshot-verify.
- P1 → blocks P2-P7 (all consume corrected tokens). No behavior deps.
- P2 → blocks P3-P7 (they consume StatCard/StatusBadge/InitialsAvatar/PipelineFunnel/top-bar).
- P3, P4, P5, P6, P7 → independent of each other once P1+P2 land; run in priority order
  (dashboards first = most visually broken; login last = already custom, lowest risk).

## Acceptance criteria (whole plan)

- Every corrected token value matches DESIGN.md exactly (Inter present, `--cmc-border`=#E5E7EB,
  green=#06C167, card radius ≤8px). Verified by a new token-lock test in `theme.test.ts`.
- `pnpm -w typecheck` clean; ESLint clean; existing test suites (`theme.test.ts`,
  `record-detail.test.ts`, `calendar-view.test.ts`, `data-table-utils.test.ts`) green.
- `gitnexus_detect_changes` before each phase commit shows only expected files; no
  business-logic symbol touched (styling-only diffs).
- Per phase: Playwright screenshot of each touched live screen visually matches its
  wireframe `screen.png` (side-by-side, reviewed by human or code-reviewer) — typecheck
  passing is NOT sufficient proof for this presentation work.
- LMS app visually unchanged (regression guard: screenshot one LMS screen before/after P1).
- `code-reviewer` subagent pass per phase before commit.

## Cross-cutting risks

| Risk | L×I | Mitigation |
|---|---|---|
| Token color/font change bleeds into LMS | Med×High | LMS overrides font via `.lms-app-root !important`; green/border tokens: verify LMS screens don't rely on `--cmc-ok`/`--cmc-border` for kid branding (grep before P1); add LMS before/after screenshot to P1. |
| Inter web-font adds network call / FOUT | Med×Med | Self-host via `@fontsource/inter` (bundled, no Google CDN) imported only in `admin/main.tsx`; keeps tokens.css "font-agnostic, no network" invariant for LMS. |
| Card radius change breaks `theme.test`/showcase | Low×Med | theme.test only locks shadows today; add radius/color locks deliberately; update showcase demos in same phase. |
| Re-skin silently alters behavior (onClick, data) in a panel | Med×High | Strict styling-only diffs; `gitnexus_impact` on any shared symbol before edit; code-reviewer diffs each panel for logic changes. |
| Regressing this-session business work (finance/CRM/attendance) | Med×High | Those panels are P3/P4 targets — reviewer explicitly checks no data-flow/handler change; screenshot-verify functional flows still render. |
| `shell.tsx` top-bar edit (high fan-out) breaks layout for all screens | Low×High | `gitnexus_impact` shell first; additive top-right elements only; keep AppShell.Header height 56px; screenshot 3 representative screens. |

## Decisions confirmed by user (2026-07-04)

1. **Button radius**: changed to 4px square per DESIGN.md literal spec (not pill). Touches
   every `Button`/`ActionIcon` default across the app — highest-fan-out single token change
   in this plan; give it its own review pass in Phase 1, screenshot at least one button-heavy
   screen (finance-panel approve/cancel actions) before/after.
2. **Green tuple recompute**: swap `cmcGreen[5]` to #06C167 + adjust `--cmc-ok-bg` tint,
   leave far stops (index 0-4, 6-9) — coherent-enough scale without a full re-ramp.
3. **Record-detail canonical variant**: #9 `vietnamese_core` (8px radius) layout +
   DESIGN.md token values.
4. **Search box in top bar**: **real, functional global search** (not a visual-only
   affordance) — scope confirmed: students (name/code/parent phone), CRM opportunities
   (contact name/phone), staff (name/email), class batches (code/name). Requires a NEW
   backend search endpoint (cross-entity, facility-scoped via existing RLS) — this makes
   Phase 2 (shared components / top bar) no longer presentation-only for this one slice.
   New sub-scope: `apps/api/src/routers/search.ts` (or extend an existing router) +
   `packages/ui` search input component wired to it. Needs its own quick scout/plan pass
   before Phase 2 implementation (endpoint shape, per-entity result limit, RLS scoping,
   debounce) — flagged as Phase 2a in the phase file, reviewed like any other backend change
   (not folded into the styling-only acceptance criteria).

## Non-goals

- No change to Zero Elevation shadow doctrine (kept; locked by `theme.test.ts`).
- No LMS restyle. No new business features. No global-search backend.
- No route/nav restructuring (nav was settled in prior plans).
