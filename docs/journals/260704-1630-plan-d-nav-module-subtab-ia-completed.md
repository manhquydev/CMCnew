# Plan D — Nav Module IA Rewrite: Derived, Not Hand-Authored

**Date**: 2026-07-04 16:30  
**Severity**: High (blast radius — every persona's nav)  
**Component**: Admin app sidebar + module/subtab IA  
**Status**: Resolved

## What Happened

Plan D (final of 4-plan autonomous sequence) completed on branch `feat/plan-d-nav-module-subtab-ia`. Converted admin app's flat 2-level nav (group label + N full-screen leaf links via ~35-case switch) into 8 left-rail modules (Giảng dạy, Lớp học, Học sinh, CRM & Kinh doanh, Tài chính, Nhân sự, Công ca, Quản trị), each opening a horizontal sub-tab bar. Pure presentation/IA change — zero new business logic, no schema, no permission grants.

Six phases, all committed:
- **P0** (7b458c4): IA design gate — red-team verified both architectural decisions against actual codebase, swept for missed URL-construction sites, found neither existed.
- **P1** (010998e): `nav-modules.ts` mechanism — derived `SECTION_TO_MODULE` from `buildNavGroups()` ONCE at load-time (no hand-authored second subtab list). Replaced sidebar render loop with `ModuleItem` + CONTROLLED `SubTabBar`. One new derivation-completeness test; 28 pre-existing nav-visibility tests unchanged.
- **P2–P4** (5c78c81, ed9a082, 8cd785d): Cluster verification across 12 role combinations. Surfaced 2 pre-existing doc inaccuracies (stale nav-permissions.ts comment, wrong plan-matrix predictions); both fixed.
- **P5** (52708e9): Regression — `pnpm -w typecheck` clean, eslint clean, 28/28 nav tests green, `gitnexus_detect_changes` confirmed only `App.tsx`/`shell.tsx`/`nav-modules.ts` touched (zero business-logic symbols).

## The Brutal Truth

This was low-drama high-risk work. Both P0 design decisions had thoroughly-reasoned RECOMMENDED answers already in the design doc; red-team's job was verifying assumptions against the codebase, not resolving a toss-up. The "derive, don't hand-author" principle meant Phases 2–4 (nominally "verify and refine module X's subtabs") discovered they had zero code changes to make — no second list existed to refine. All actual risk was concentrated in P1's mechanism, which is exactly where the dedicated code review and most live-verification effort went. The result: a genuinely high-impact change (affects every nav click for every persona) with a narrow, locked-in attack surface.

## Technical Details

**P0 Design Gate** — Red-team (code-reviewer subagent) ran an adversarial pass against the design doc's code citations, grepped the entire repo for any URL-construction site the doc might have missed (`navigate(`, `<a href`, email templates, nginx config, other apps), and found none that Option C (flat URL scheme + pure-presentation module derivation) would break. Two cosmetic doc-accuracy defects corrected (which nav test file actually uses `keysOf()` pattern; where facilityId derivation actually lives).

**P1 Mechanism** — Created `apps/admin/src/nav-modules.ts`, scanning `buildNavGroups({roles:[], isSuperAdmin:false})` ONCE at module-load time to derive `SECTION_TO_MODULE`. Deliberately NOT hand-authoring a parallel `MODULES.subtabs` list (group membership is role-invariant; a second list would be a second source of truth). Added `key` + `icon` to 8 groups in `shell.tsx`; replaced `SidebarItem`+`GroupLabel` loop with `ModuleItem` (rail icon/label) + `SubTabBar` (CONTROLLED Mantine `Tabs`, `value`/`onChange` synced to URL-derived `activeSection`, not the uncontrolled `defaultValue` pattern an existing precedent used — explicitly flagged as new work in the design doc). SubTabBar suppresses itself entirely when module ≤1 visible subtab. One new test: derivation-completeness guard (every `SectionKey` except `profile` maps to exactly one module, explicit duplicate-detection). 28 pre-existing nav-visibility tests required BYTE-FOR-BYTE unchanged (all passed). Code review verified 6 risk areas: Mantine `Tabs` tolerance for controlled `value` outside rendered tabs (safe, no crash/warning), mobile `overflowX:auto` CSS correctness (verified against compiled Mantine CSS), ESM load ordering, and others.

**P2–P4 Cluster Verification** — Deterministic `buildNavGroups()` checks across 12 role combinations (super_admin, single-role teachers, directors, `ke_toan`, `sale`, `ctv_mkt`, `cskh`, `hr`, multi-role), plus live Playwright smoke against dev app. Fixed stale nav-permissions.ts comment (noted that `sale` also sees `cskh`; was omitted from comment, zero behavior change). Corrected plan-matrix predictions (giam_doc_kinh_doanh sees 3, not all 4 CRM subtabs). Live-verified `goToClass` deep-nav closure and cockpit→KPI cross-module jump — both work by construction (module/subtab are pure derived, no per-flow special-casing). Got an unplanned-but-valuable test of "SubTabBar tolerates activeSection outside active module's visible set": navigating to `/biz-director-cockpit` as super_admin (gated OUT of super_admin's `quan-tri` visible) rendered clean with no crash, no false tab highlight.

**P5 Regression** — Verified `SidebarItem`/`GroupLabel` fully replaced (grep: zero remaining refs). `pnpm -w typecheck` clean (12 packages), full eslint on admin app clean (one pre-existing unrelated warning), full nav test (28/28 green), `gitnexus_detect_changes({scope:'compare', base_ref:'feat/phase-d-facility-picker-and-stitch-wireframes'})` confirmed only `App.tsx`/`shell.tsx`/`nav-modules.ts` changed, zero business-logic symbols touched, matching acceptance criteria exactly. `pnpm -w test` surfaced one pre-existing, unrelated failure (`@cmc/e2e#test`, `import.meta` syntax error) — confirmed via `git checkout` to base branch that it fails identically with ZERO Plan D changes, not a regression.

## Root Cause Analysis

No failures. Success because:
1. **IA design was lock-in-ready at P0.** Both decisions had thoroughly-reasoned RECOMMENDED answers; red-team verified, didn't debate.
2. **"Derive, don't hand-author" eliminated drift.** No parallel `MODULES.subtabs` list = no second source of truth to fall out of sync with `buildNavGroups()`.
3. **Blast radius was managed by scope.** Presentation-only; group membership already exists and is stable. No business logic, no schema, no permission model changes.

## Lessons Learned

1. **High-risk architectural decisions can be low-drama if tradeoff analysis is thorough and upstream-verified.** Red-team's job was verifying one side's assumptions against the codebase (faster, more reliable) than debating both sides.
2. **"Derive from stable source, don't hand-author" scales better than maintenance.** This meant Phases 2–4 had zero code changes — only verification, not refinement. One new completeness guard beats N per-subtab tests.
3. **Cluster-verification + one dedicated code review is the right investment for big-bang UI refactors.** Found zero code bugs, two doc inaccuracies, and full cross-persona confidence.
4. **Controlled component patterns (like Mantine's `Tabs` with managed state) are safer for nav than uncontrolled defaults** — especially when syncing to URL-derived state.

## Next Steps

- Merge `feat/plan-d-nav-module-subtab-ia` → `develop` (or directly to `main` via PR if sequence is ready).
- This closes the 4-plan autonomous sequence (A: UX quickfixes, B: datetime pickers, C: student phone login, D: this one). No follow-up work.
- Nav module IA is now foundation for future cross-nav features (search scoping per module, per-module permission audits, etc.).
