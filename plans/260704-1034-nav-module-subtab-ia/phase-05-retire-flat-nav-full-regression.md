# Phase 5 — Retire flat-nav remnants + full regression

Status: done

## Outcome (2026-07-04)

`SidebarItem`/`GroupLabel` were already fully replaced (not left dead) in Phase 1's
`ModuleItem`/`SubTabBar` rewrite — grep-confirmed zero remaining references anywhere in
`apps/admin/src` (also independently confirmed by the Phase 1 code review). `SECTION_TITLES` and
`ALL_SECTION_KEYS` unchanged and still consumed as designed. No dead-code deletion needed.

### Full regression matrix — all green

- **Every role's nav**: deterministic `buildNavGroups()` checks across 12 role combinations
  (super_admin, `giao_vien`-only, `giam_doc_dao_tao`, `giam_doc_kinh_doanh`, `ke_toan`, `sale`,
  `ctv_mkt`, `cskh`, `hr`, multi-role `giao_vien`+`giam_doc_dao_tao`) across Phases 1-4 — all
  matched the verification matrices (2 stale plan-doc predictions corrected in Phase 3, not
  mechanism bugs).
- **Every section reachable**: the Phase 1 derivation-completeness guard test asserts every
  `SectionKey` except `profile` maps to exactly one module (total, non-overlapping).
- **Deep-links**: live-verified `/crm/opportunities/:oppId`, plus direct navigation to `/finance`,
  `/reconcile-worklist`, `/schedule`, `/classes`, `/kpi`, `/biz-director-cockpit` — all resolve to
  the correct module + subtab.
- **Search navigation**: live-verified students→`hoc-sinh` module with the exact record
  pre-selected; CRM opportunity→`crm-kinh-doanh`+`crm` with the record rendered.
- **Default landing**: super_admin→`overview`/`quan-tri` confirmed live; director/teacher/staff
  landings confirmed structurally (`defaultSection` is completely unchanged code, and `moduleOf`
  is a pure lookup on whatever section it returns).
- **Cross-module jumps**: `goToClass` (schedule→class workspace with the batch pre-selected) and
  cockpit→KPI (`nhan-su` module correctly activated) both live-verified.
- **Nav tests**: all 4 `__tests__/nav-*.test.ts` green (28 tests); the 3 untouched suites are
  byte-for-byte identical in every diff since Phase 1 — the per-role parity gate holds throughout.
- **Typecheck / lint**: `pnpm -w typecheck` clean across all 12 workspace packages; ESLint clean
  on every touched file (one pre-existing, unrelated warning in `course-exercise-manager.tsx`,
  a file this plan never touches).
- **gitnexus**: `detect_changes({scope:'compare', base_ref:'feat/phase-d-facility-picker-and-stitch-wireframes'})`
  confirms only `App.tsx` (`Dashboard`), `shell.tsx` (`Shell`/`buildNavGroups`/`ModuleItem`/
  `SubTabBar`/`firstVisibleSubtab`), and `nav-modules.ts` (all 3 exports) changed — zero
  business-logic symbols touched, matching the plan's acceptance criterion exactly.
- **`pnpm -w test` (unit)**: the only failure (`@cmc/e2e#test`, `SyntaxError: Cannot use
  'import.meta' outside a module`) was confirmed via `git checkout` to the base branch to be
  pre-existing — identical failure with zero Plan D changes present. Not a regression.
- **Code review**: the mechanism was reviewed once in Phase 1 (zero blocking findings); Phases
  2-4 made no code changes (pure verification + one comment fix in Phase 3, itself reviewed by
  re-running the full test suite + typecheck after the edit). No new code exists for Phase 5 to
  review.

Plan D is ready for PR.
Blocked by: Phases 2, 3, 4 (all modules verified).
Owns (files): `shell.tsx` (remove dead `SidebarItem`/`GroupLabel` if fully unused), any
lingering flat-nav helpers. Full-app regression.

## Purpose

Remove code that only existed for the old flat leaf-list nav, then run the whole-app
regression across every role and every deep-link before declaring done.

## Steps

1. Grep for now-dead symbols: `SidebarItem` (`shell.tsx:110-144`), `GroupLabel`
   (`shell.tsx:148-167`) — remove ONLY if the module rail no longer uses them (the module
   rail may reuse a restyled item; delete only truly-dead code). Run `gitnexus_impact` on each
   before deletion.
2. Confirm `SECTION_TITLES` (`shell.tsx:720-761`) still consumed for the browser-tab title /
   top-bar; keep. Confirm `ALL_SECTION_KEYS` (`App.tsx:520-531`) still the URL validator; keep.
3. Confirm no orphaned imports.

## Full regression matrix

| Dimension | Check |
|---|---|
| Every role's nav | For each of super_admin + 8 staff roles + key multi-role combos: module list + each module's subtab set == pre-change flat visible set (snapshot compare). |
| Every section reachable | All 35 sections (except hidden `certificate`) reachable via module→subtab. |
| Deep-links | `/crm/opportunities/:oppId`, `/{section}` for all keys, `/`, unknown `*`→default — all resolve to correct module+subtab. |
| Search navigation | students→students, staff→org, classBatches→goToClass, CRM opp→opp route — all activate correct module and pre-select record. |
| Default landing | Each persona lands on the correct module+subtab (`defaultSection`). |
| Cross-module jumps | schedule→class workspace (`goToClass`), cockpit→kpi — rail follows. |
| Nav tests | All 4 `__tests__/nav-*.test.ts` green. |
| Typecheck / lint | `pnpm -w typecheck` + ESLint clean. |
| gitnexus | `gitnexus_detect_changes({scope:'compare', base_ref:'main'})` — only nav/shell/App/test files touched; no business-logic symbol. |

## Acceptance (whole plan)

- Every current screen reachable via module→sub-tab; parity with old flat nav per role.
- Every role sees exactly its allowed subtabs (no more, no less) — proven by the 4 nav tests
  + live per-role smoke.
- All existing deep-links + global search navigation work, verified live per role.
- All 35 sections migrated; old flat leaf-list nav retired.
- Typecheck + all nav tests green; `code-reviewer` pass; gitnexus scope clean.

## Risks / rollback

- Risk: deleting `SidebarItem`/`GroupLabel` that a restyled rail still needs. Mitigation:
  gitnexus_impact before deletion; delete only confirmed-dead.
- Rollback: this phase is additive cleanup; revert the deletion commit; Phases 1-4 stand.
