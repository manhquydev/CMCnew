# Phase 5 — Retire flat-nav remnants + full regression

Status: pending
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
