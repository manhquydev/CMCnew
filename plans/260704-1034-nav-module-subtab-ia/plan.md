---
title: "Nav module + sub-tab IA restructure"
description: "Convert the admin app's flat 8-group leaf nav into 8 left-rail modules, each opening a horizontal sub-tab bar of its screens — presentation/IA only, URL contract preserved."
status: implemented
priority: P2
lane: high-risk
effort: 3-4d (P0 gate + 1 mechanism phase + 3 verify clusters + regression)
branch: feat/phase-d-facility-picker-and-stitch-wireframes
tags: [nav, ia, routing, ux, high-risk]
created: 2026-07-04
sourceReports:
  - plans/reports/brainstorm-260704-1034-four-plan-decomposition-ux-auth-nav-report.md
---

## Overview

Plan D of the 4-plan decomposition (brainstorm report §4, §"The 4 plans"). Today the admin
nav is a flat 2-level presentation: a group label + N independent leaf `NavLink`s, each a
full-screen swap via a ~35-case `switch` (`App.tsx:620-883`). This plan turns the **existing 8
nav groups into 8 top-level MODULES**: the left rail shows one icon+label per module; clicking
it opens a **horizontal sub-tab bar** of that module's screens (consuming the already-themed
Mantine `Tabs`, `packages/ui/src/theme.ts:332-355`). Business/permission boundaries do not
move — grouping = the current 8 groups verbatim (user-confirmed, brainstorm §decisions #4).

User accepted the higher-risk **full conversion in one plan** (all-at-once, not staged POC).

Design substance lives in [`design/ia-module-subtab-map.md`](design/ia-module-subtab-map.md)
— the module→subtab map, URL scheme, role-gating mapping, component architecture. Read it
first; it is the P0 gate.

## The two decisions this plan hinges on (P0 gate)

1. **URL scheme** — RECOMMENDED **Option C**: keep the flat `/{sectionKey}` URL and *derive*
   the module from the section (`SECTION_TO_MODULE` lookup). The URL contract is unchanged, so
   the search deep-link contract (`SEARCH_GROUPS`, `shell.tsx:231-241`), the
   `/crm/opportunities/:oppId` route (`App.tsx:914`), and the build-time route-metadata dirs
   (`link-preview-metadata.ts:102-124`) all keep working by construction — this eliminates the
   #1 regression risk. Alternative **Option A** (two-segment `/{module}/{subtab}` + a 35-entry
   redirect layer + metadata-dir migration) gives richer URLs at materially higher risk/cost.
2. **Switch vs registry** — RECOMMENDED **hybrid**: a nav-only module layer **derived from
   `buildNavGroups`** (the rail + SubTabBar read the existing group membership/order/icon/label;
   NO separately-authored `MODULES.subtabs` list, which would be a second source of truth — B2)
   + keep the `renderContent` switch (the view layer with per-panel closures like
   `goToClass`/`navAction`/`oppId` — not duplication). Alternative: full render-fn registry
   (larger, riskier refactor).

Plan phases assume C + hybrid. If A is chosen, Phase 1 grows a redirect sub-task and Phases
2-4 grow per-module route wiring (deltas noted in each phase file).

## Phases

| # | Phase | Owns (files) | Status | File |
|---|---|---|---|---|
| 0 | IA design + decisions gate | design doc, this folder (no code) | pending | [phase-00-ia-design-and-decisions.md](phase-00-ia-design-and-decisions.md) |
| 1 | Nav registry + module rail + SubTabBar (big-bang mechanism) | `nav-modules.ts`(new, derived from `buildNavGroups`), `shell.tsx`, `App.tsx`, +1 new derivation-guard test; the 4 existing `nav-*.test.ts` suites run UNCHANGED as the parity gate | pending | [phase-01-nav-registry-module-shell-subtabbar.md](phase-01-nav-registry-module-shell-subtabbar.md) |
| 2 | Verify academic cluster (Giảng dạy / Lớp học / Học sinh) | `nav-modules.ts` (subtab refine), nav-test assertions | pending | [phase-02-verify-academic-cluster.md](phase-02-verify-academic-cluster.md) |
| 3 | Verify business/HR cluster (CRM & KD / Tài chính / Nhân sự) | `nav-modules.ts` (subtab refine), nav-test assertions | pending | [phase-03-verify-business-hr-cluster.md](phase-03-verify-business-hr-cluster.md) |
| 4 | Verify ops/admin cluster (Công ca / Quản trị) + cockpit edges | `nav-modules.ts` (subtab refine), 2× cockpit nav-tests | pending | [phase-04-verify-ops-admin-cluster.md](phase-04-verify-ops-admin-cluster.md) |
| 5 | Retire flat-nav remnants + full regression | `shell.tsx` (dead-code), whole-app regression | pending | [phase-05-retire-flat-nav-full-regression.md](phase-05-retire-flat-nav-full-regression.md) |

## Dependencies

- P0 → gate; blocks everything (decisions set P1 scope).
- P1 → mechanism; blocks P2-P5. Big-bang shell swap (all 8 modules render at once).
- P2, P3, P4 → independent of each other once P1 lands (different module clusters, but all
  touch `nav-modules.ts` subtab lists — sequence them, do NOT parallelize edits to that file).
- P5 → after all clusters verified.
- **Merge / prod-exposure safety (accepted all-at-once risk).** The feature branch stays
  **UNMERGED** — no `main`/prod exposure — until P5 full regression passes; then P1-P5 land as a
  **single reviewed merge**. P1's big-bang shell swap therefore never reaches prod ahead of
  P2-P4 cluster verification (they are verified on the branch, not behind a flag). There is
  **NO feature-flag / runtime kill-switch**: rollback = `git revert` the merge + redeploy (the
  URL contract never changed under Option C, so there is no data/route migration to undo). This
  is the accepted cost of the user's big-bang (all-at-once) choice.

## The 8 modules (see design §2 for full subtab map + gates)

Giảng dạy · Lớp học · Học sinh · CRM & Kinh doanh · Tài chính · Nhân sự · Công ca · Quản trị.
`profile` stays outside the rail (avatar menu). `certificate` stays hidden (visible:false).

## Acceptance criteria (whole plan)

- Every current screen reachable via module→sub-tab; per-role parity with the old flat nav.
- Every role sees exactly its allowed subtabs (no more, no less) — proven by the 4 existing
  `nav-*.test.ts` suites staying green **unchanged** (parity gate) + the new derivation guard +
  live per-role smoke.
- All existing deep-links + global-search navigation still work, verified live per role
  (students/staff/classBatches/CRM-opp).
- All 35 `switch` sections migrated; old flat leaf-list nav retired.
- `pnpm -w typecheck` clean; all 4 nav test suites green; `code-reviewer` pass per phase;
  `gitnexus_detect_changes` scope-clean (no business-logic symbol touched).

## Cross-cutting risks

| Risk | L×I | Mitigation |
|---|---|---|
| Routing rewrite breaks just-shipped search deep-links | Low×High (Option C) / High×High (Option A) | Option C keeps URL contract untouched — no redirect layer. Explicit compat proof in P1. |
| Big-bang shell swap breaks a role's nav | Med×High | 4 nav tests + per-persona live smoke before each commit; single-file rail change revertible. |
| Single-subtab modules (teacher-only) render an odd lone tab | Med×Low | Suppress SubTabBar when ≤1 visible subtab; rail shows the module label (uniform — user decision, design §5.4). |
| SubTabBar overflows on narrow screens (5-6 subtabs, no auto-scroll) | Med×Med | Require scrollable/wrapping `Tabs.List` on `< sm` (design §6.4); mobile smoke in P1 (S3). |
| Cockpit-replaces-overview / director default landing mis-resolves | Med×High | `defaultSection`/`isXOnly` logic reused verbatim; P4 live-verifies both directors. |
| Nav-consistency test drift | Med×Med | NAV_GATES↔PERMISSIONS untouched; the 4 nav suites run **unchanged** as the parity gate (their `keysOf()` is grouping-agnostic); only a new one-module-per-section derivation guard is added. Rewriting the suites is forbidden — it would mask regressions (S4). |

## Non-goals

- No change to NAV_GATES / PERMISSIONS / role model (grouping presentation only).
- No new business features; no panel logic change; no LMS change.
- No nav grouping change beyond the existing 8 groups (brainstorm §out-of-scope).
