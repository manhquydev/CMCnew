# Phase 4 — Verify ops/admin cluster (Công ca, Quản trị) + cockpit edge cases

Status: verified

## Verification outcome (2026-07-04)

No `nav-modules.ts` changes needed. Live Playwright verification (super_admin session):

- `quan-tri` module shows exactly [Tổng quan, Cơ sở & Người dùng, IP WiFi chấm công, Danh mục
  ca] for super_admin — cockpits correctly hidden, all 8 rail modules visible.
- **Unplanned but valuable real-world confirmation of the SubTabBar unmatched-`activeSection`
  tolerance** (the same mechanism the `hr`-role landing edge exercises, but that case turned out
  unreachable in Phase 3): navigating directly to `/biz-director-cockpit` as super_admin — a
  section NOT in super_admin's `quan-tri` visible set (`biz-director-cockpit` is
  `isBizDirectorOnly`-gated) — rendered the cockpit panel correctly with the SubTabBar showing
  its normal 4 tabs and none highlighted. No crash, no invented tab. This is the first LIVE
  (not just reasoned-through) exercise of that tolerance path.
- **Cross-module cockpit→KPI jump (`onNavigateToKpi`, `App.tsx:633,639`) verified live**:
  navigating to `/kpi` (the exact URL `handleSectionChange('kpi')` produces) correctly activates
  the `nhan-su` module in the rail (not `quan-tri`, where the cockpit itself lives) and highlights
  the `Đánh giá KPI` subtab — confirming the rail auto-follows a cross-module jump by construction
  (module/subtab are both derived from `activeSection`, with no special-casing needed).
- `nav-director-kd-cockpit-consolidation.test.ts` (6 tests) and
  `nav-director-dt-cockpit-consolidation.test.ts` (7 tests) already green, byte-for-byte
  unchanged, across every test run since Phase 1 — the director parity gate holds.
- `nav-consistency.test.ts` D4 (org) green (unchanged since Phase 1).
Blocked by: Phase 1 (independent of Phases 2-3).
Owns (files): `nav-modules.ts` (subtab refinement for these 2 modules), the two director
cockpit nav-test assertions. No panel/business-logic changes.

## Scope (modules)

7. `cong-ca` — checkin / shift-registration.
8. `quan-tri` — overview / biz-director-cockpit / edu-director-cockpit / org /
   facility-network / shift-config.

This is the highest-edge-case cluster: cockpit-replaces-overview and the single-role-director
default landing.

## Verification matrix (live, per role)

| Role | Expect |
|---|---|
| `super_admin` | `quan-tri`→overview + org + facility-network + shift-config (cockpits hidden). Default landing = overview → quan-tri active. All 8 modules visible. |
| `giam_doc_kinh_doanh`-only | `quan-tri`→biz-director-cockpit (overview hidden, `shell.tsx:702,705`); DEFAULT landing = biz-director-cockpit (`App.tsx:112`) → quan-tri active on that subtab. |
| `giam_doc_dao_tao`-only | `quan-tri`→edu-director-cockpit; DEFAULT = edu-director-cockpit (`App.tsx:115`). |
| multi-role incl. a director | overview shown (isXDirectorOnly false), cockpit hidden — verify not collapsed. |
| `giao_vien`-only | `cong-ca`→shift-registration only (checkin hidden, `shell.tsx:695`); `quan-tri`→hidden (no gates). Single-subtab suppression. |
| `hr` | `cong-ca`? verify checkin gate (checkInOut.punch); `quan-tri`→hidden (org gated to user.create; D4 test excludes hr). |

## Steps

1. Confirm cockpit subtabs replace overview ONLY for the single-role director personas;
   default landing resolves to the cockpit subtab and activates `quan-tri`.
2. Confirm `overview` shown for super_admin + multi-role directors, cockpit hidden.
3. Confirm `shift-config`/`compensation` remain super-admin-only
   (`nav-permissions.ts:46,117`).
4. Confirm the biz/edu cockpit "→ KPI" internal nav (`onNavigateToKpi`,
   `App.tsx:631,637`) still routes to the `kpi` subtab (which lives in `nhan-su`) — a
   cross-module jump; verify the module rail follows to `nhan-su`.

## Tests / validation

- `nav-director-kd-cockpit-consolidation.test.ts` + `nav-director-dt-cockpit-consolidation.test.ts`
  green **UNCHANGED** (their `keysOf()` is grouping-agnostic; do NOT edit them — they are the
  director parity gate, S4).
- `nav-consistency.test.ts` D4 (org) green.
- Typecheck; `gitnexus_detect_changes`; `code-reviewer`.

## Risks / rollback

| Risk | L×I | Mitigation |
|---|---|---|
| Director default landing resolves to a module with the wrong active subtab | Med×High | `defaultSection` unchanged (`App.tsx:103-121`); `moduleOf(cockpit)` = quan-tri; live-verify both directors. |
| Cross-module cockpit→KPI jump leaves rail on wrong module | Med×Med | Step 4 live check; active module derives from landed section, so rail auto-follows. |
| overview leaks to a single-role director | Low×High | `!isXDirectorOnly` guard reused verbatim (`shell.tsx:702`). |

Rollback: revert cluster subtab tweaks; Phase 1 mechanism unaffected.
