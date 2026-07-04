# Phase 1 — Nav registry + module rail + SubTabBar (mechanism, big-bang shell)

Status: pending
Blocked by: Phase 0 gate (decisions locked).
Assumes: Option C (flat URL) + hybrid (nav-only registry). See §"If Option A" for the delta.

## Purpose

Build the full module/sub-tab mechanism and prove the routing/search-deep-link contract is
untouched. This is a big-bang shell swap (user accepted all-at-once). After this phase the
sidebar renders 8 modules and every screen is reached via module→horizontal-subtab, with the
URL scheme unchanged.

## Data flow

`me.roles` → `buildNavGroups` (per-leaf `visible`, now + module `key`/`icon`) →
`SECTION_TO_MODULE` derives `activeModuleKey` from URL-derived `activeSection` →
`Shell` renders module rail (icon+label) + `SubTabBar` (visible subtabs of active module) →
click subtab/module → `onSectionChange('/'+sectionKey)` (unchanged) → URL → `activeSection`
→ `renderContent` switch (unchanged) renders panel into `{children}`.

## Files to modify / create

| File | Change |
|---|---|
| `apps/admin/src/nav-modules.ts` (new) | `moduleOf(section)` + `firstVisibleSubtab(group)` + `SECTION_TO_MODULE`, all **derived by scanning `buildNavGroups` output** (membership is role-invariant `items[].key`; module order = group declaration order). NO hand-authored `MODULES.subtabs` list — `buildNavGroups` stays the single source of grouping/order/icon/label (B2). |
| `apps/admin/src/shell.tsx` | Extend `NavGroup` with `key`+`icon` (`:103-106`); rewrite sidebar render (`:549-565`) to module rail; add `SubTabBar` component consuming themed `Tabs`; render it atop `AppShell.Main` (`:569-573`); extend `Shell` props with `activeModuleKey` + active module's visible subtabs. `buildNavGroups` (`:625-714`) gains per-group `key`+`icon`. |
| `apps/admin/src/App.tsx` | Compute `activeModuleKey`/visible-subtabs from `activeSection` (`:560-566`); pass to `<Shell>` (`:885-894`). Switch, `handleSectionChange`, `handleSearchNavigate`, routes, `ALL_SECTION_KEYS`, `defaultSection` UNCHANGED. |
| `apps/admin/src/__tests__/nav-consistency.test.ts` | Existing assertions (NAV_GATES↔PERMISSIONS) unchanged — re-run to confirm still green. **ADD one guard:** every `SectionKey` except `profile` maps to exactly one module via the **derived** `SECTION_TO_MODULE` (i.e. `buildNavGroups` membership is total + non-overlapping). Since the map is derived from `buildNavGroups`, this asserts the derivation is complete, not that a hand-list matches. |
| `apps/admin/src/__tests__/nav-teacher-consolidation.test.ts` | **Run UNCHANGED — do NOT edit.** `keysOf()` (`:29-32`) reads `groups.flatMap(g=>g.items.filter(visible).map(key))`, agnostic to module grouping; it stays green byte-for-byte and IS the `giao_vien`-only parity gate. |
| `apps/admin/src/__tests__/nav-director-dt-cockpit-consolidation.test.ts` | **Run UNCHANGED — do NOT edit.** Same grouping-agnostic `keysOf()`; must stay green as the GĐĐT parity gate. |
| `apps/admin/src/__tests__/nav-director-kd-cockpit-consolidation.test.ts` | **Run UNCHANGED — do NOT edit.** Must stay green as the GĐKD parity gate. |

## Implementation steps

1. Create `nav-modules.ts`: build `SECTION_TO_MODULE` by **scanning `buildNavGroups` output**
   (`items[].key` per group — role-invariant membership; module order = group declaration order);
   `moduleOf(section)` (lookup, returns null for `profile`), `firstVisibleSubtab(group)` (first
   item with `visible`). Do NOT hand-author a `MODULES.subtabs` array — deriving from
   `buildNavGroups` keeps one source of truth (B2).
2. Extend `NavGroup` type + `buildNavGroups` to attach `key` + `icon` per group (reuse
   design §2 icon table; icons already imported).
3. `SubTabBar` component: controlled `Tabs` (`value={activeSection}`, `onChange`), one
   `Tabs.Tab` per visible subtab; render nothing when the active module has ≤1 visible subtab
   (§design 5.4). Tab strip only — NO `Tabs.Panel` (panels stay in the switch).
4. Rewrite sidebar: `navGroups.filter(g => g.items.some(i=>i.visible)).map(ModuleItem)`;
   `active = g.key === activeModuleKey`; click → `onSectionChange(firstVisibleSubtab(g))`.
5. `App.tsx`: `const activeModuleKey = moduleOf(activeSection)`; pass `activeModuleKey` +
   the active group's visible subtabs to `<Shell>`; render `<SubTabBar>` inside Shell.
6. Add ONLY the new one-module-per-section derivation guard to `nav-consistency.test.ts`. Do
   NOT modify the 4 existing nav suites — they must stay green byte-for-byte as the per-role
   parity gate; rewriting them to match new behavior would mask regressions (S4).

## Tests / validation

- `pnpm -w typecheck` clean.
- All 4 existing nav test suites green **byte-for-byte unchanged** (the per-role parity gate);
  the new derivation guard green. If any of the 4 needs editing to pass, STOP — that signals a
  real visibility regression, not a test that needs updating (S4).
- **Search-deep-link compat proof (the #1 acceptance item):** assert in test or live smoke
  that `SEARCH_GROUPS` targets still resolve — students→`/students`, staff→`/org`,
  classBatches→`goToClass`, CRM opp→`/crm/opportunities/:id` — and that each resolved section
  activates the correct module. Live: run global search per entity, click result, confirm the
  right module+subtab is active and the record is pre-selected.
- Live smoke per persona: super_admin, giao_vien-only, ke_toan, giam_doc_kinh_doanh-only,
  giam_doc_dao_tao-only — default landing lands on the right module+subtab; every visible
  module opens to its first subtab; no empty module rendered.
- `/crm/opportunities/:oppId` deep-link still opens the opp with `crm-kinh-doanh` module +
  `crm` subtab active.
- Browser back/forward keeps SubTabBar in sync (controlled Tabs) — this URL↔strip sync is new
  work (not proven by the `student-management-panel` precedent, which is uncontrolled).
- **Mobile / responsive (S3):** on `< sm`, verify the hamburger → open module rail → pick
  module → SubTabBar flow works, and that a 5-6-subtab module's `Tabs.List` (`giang-day`,
  `lop-hoc`, `quan-tri`) is horizontally scrollable/wrapped so every subtab stays reachable.
  Implement the `Tabs.List` scroll/wrap behavior for `< sm` when building `SubTabBar`.
- `gitnexus_impact` on `buildNavGroups` + `Shell` before edit; `gitnexus_detect_changes`
  after — only expected files.
- `code-reviewer` pass.

## Risks / rollback

| Risk | L×I | Mitigation |
|---|---|---|
| Big-bang shell swap breaks nav for a role | Med×High | 4 nav tests + per-persona live smoke before commit; single-file rail change is revertible. |
| Search deep-link / oppId route regresses | Low×High | Option C leaves URL contract untouched by construction; explicit compat proof above. |
| Single-subtab module renders a lone tab awkwardly | Med×Low | §5.4 suppress-bar + uniform module-label rail; verify a giao_vien-only single-subtab module live (`lop-hoc`/`crm-kinh-doanh`/`nhan-su`/`cong-ca` — NOT `giang-day`, which has 2 subtabs schedule+attendance-report). |
| Active-module mis-resolves for `profile` (no module) | Low×Med | `moduleOf` returns null → no rail highlight (matches today). |
| `keepMounted`/state-reset surprise | Low×Med | Tab strip only, no `Tabs.Panel`; panel lifecycle unchanged. |

Rollback: revert `shell.tsx` sidebar block + remove `SubTabBar`/`nav-modules.ts`; `App.tsx`
Shell-props revert. URL contract never changed, so no data/route migration to undo.

## If Option A (path URLs) was chosen at the gate

Add: nested route `/:module/:subtab` in `App.tsx:908-921`; `LEGACY_SECTION_REDIRECTS` (35
entries) + catch route rewriting old `/{section}`; re-parent/exclude
`/crm/opportunities/:oppId`; regenerate `ADMIN_ROUTE_METADATA` at two-segment paths
(`link-preview-metadata.ts:102-124` + `vite.config.ts:42-59`); update `handleSearchNavigate`
to emit two-segment paths. Re-verify every deep-link post-redirect.
