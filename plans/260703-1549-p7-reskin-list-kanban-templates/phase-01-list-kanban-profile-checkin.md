# Phase 1 — Re-skin DataTable/ViewSwitcher + build profile page + fix checkin nav

**Lane**: normal (re-skin is cosmetic token-only; profile page is new; checkin nav is a label/structure change)

## Context links

- `plans/260703-1549-p1-token-remap-zero-elevation/` — must be committed (it is) before touching shadow/border on these components
- `packages/ui/src/data-table.tsx`, `packages/ui/src/view-switcher.tsx` — target files, both read in full
- `apps/admin/src/shell.tsx`, `nav-permissions.ts`, `apps/admin/src/__tests__/nav-teacher-consolidation.test.ts` — checkin nav structure (finding #12)
- Earlier `/stitch` wireframe review — profile/settings page (finding #19)

## Resolved findings (confirmed by direct code read + red-team, 2026-07-03)

1. **`view-switcher.tsx` has NO drag-and-drop** — confirmed both by direct read AND a whole-repo grep for `@dnd-kit`/`react-beautiful-dnd`/`react-dnd`/`onDragStart`/`draggable=` (only hit: an unrelated `draggable={false}` on an image in `pdf-annotator.tsx`; `pnpm-lock.yaml` has no dnd library at all). Kanban re-skin is purely cosmetic, no functional rework.
2. **DataTable/ViewSwitcher have no explicit shadow override** — confirmed by full read of both files (`data-table.tsx`'s Card uses `p={0} withBorder`, no `shadow`; `ViewSwitcher` is a bare `SegmentedControl`). Both inherit P1's theme defaults already — sub-part A may end up being a no-op verification, not an actual edit.
3. **RecordDetailPanel does NOT fit the profile page — committing to a bespoke form (red-team correction, was "evaluate at implementation time," now firm).** `RecordDetailField.type` has no `password` type, and the primitive's save model is one full-form `onSave(data)` patch — "change-password" is a distinct action/flow with its own validation (current/new/confirm), and "active-session/logout" is a button, not editable state. Neither fits the field-grid model. Build a plain bespoke form component instead.
4. **No avatar dropdown exists today (red-team correction — real scope gap, not just wiring).** `shell.tsx` renders a bare `<Avatar>` (tooltip only, no click handler) next to a separate `<Button>Đăng xuất</Button>` — there is no `Menu`/dropdown to extend. Sub-part B must BUILD this chrome: wrap `Avatar` in a Mantine `Menu`, move "Đăng xuất" into it, add "Hồ sơ" as a new item.
5. **Section-key routing is a 5-file coordinated edit, not "add a new section key" (red-team correction).** Adding a routable `profile` section requires, in order: (a) `shell.tsx` — add to the `SectionKey` union; (b) `shell.tsx` — add an entry to `SECTION_TITLES: Record<SectionKey, string>` (total record, TS errors if omitted); (c) `nav-permissions.ts` — add an entry to `NAV_GATES` (also a total `Record<SectionKey, NavGate>`); (d) `App.tsx` — add to `ALL_SECTION_KEYS` set AND a `renderContent()` switch case; (e) `nav-consistency.test.ts` — its `expectedOpen` array is hardcoded; if `profile` gates as `'open'` (likely, any logged-in user), this test needs manual updating or it fails. `link-preview-metadata.ts` is optional/lower-priority (Partial record).
6. **Checkin (finding #12) constraint is narrower than originally scoped — reworded.** Checkin is ALREADY a standalone top-level nav item (`shell.tsx` line ~474, `visible: !isTeacherOnly && visible('checkin')`) for every role except single-role `giao_vien` — the "nested" problem is scoped ONLY to the `isTeacherOnly` collapse case (`payroll-checkin`), not all roles. `nav-teacher-consolidation.test.ts` (lines 48-58) **hard-asserts** a `giao_vien`-only account sees `payroll-checkin` and does NOT see standalone `checkin` — it's explicitly in `COLLAPSED_SECTIONS`. Two real options with different cost:
   - **Relabel** (keep `payroll-checkin` merged, improve wording only) — zero test changes, safe, minimal-diff.
   - **Restructure** (give teacher-only accounts a standalone `checkin` item too) — requires editing `nav-teacher-consolidation.test.ts`'s hardcoded assertions, i.e. intentionally changing a documented, deliberately-tested invariant, not just "confirming no regression" by re-running the suite.

## Scope — 3 sub-parts, sequenced within this phase

### A. Re-skin DataTable + ViewSwitcher (cosmetic verification, likely no-op)
- Confirm no shadow override exists (already confirmed above) — if the visual review in `design-showcase.tsx` shows anything off, fix it; otherwise this sub-part is a verification pass, not an edit.
- Contract (`DataTableColumn`/`DataTableProps`/`ViewMode`) MUST stay identical — P4 depends on this.

### B. Profile/settings page (finding #19 — new screen + new dropdown chrome)
- Build the avatar `Menu` dropdown chrome in `shell.tsx` (finding #4 above) — "Hồ sơ" + "Đăng xuất" as menu items.
- Build a bespoke `apps/admin/src/profile-settings-panel.tsx` (finding #3 above — NOT RecordDetailPanel): personal info fields, change-password section (or SSO notice), notification-preferences toggles, active-session/logout button, per the approved `/stitch` wireframe.
- Wire routing per the 5-file checklist above (finding #5).

### C. Checkin nav discoverability (finding #12 — user-confirmed: RELABEL)
- **Decision (2026-07-03, user-confirmed)**: relabel only. Keep `payroll-checkin` merged for `isTeacherOnly` accounts, improve the label wording so "chấm công" is clearly findable within it. Zero changes to `nav-teacher-consolidation.test.ts`.

## Implementation steps

1. Sub-part A: verify (not necessarily edit) `data-table.tsx`/`view-switcher.tsx` shadow-free per the confirmed findings above; visual check via `design-showcase.tsx`.
2. Sub-part B: build the avatar `Menu` in `shell.tsx`; build the bespoke profile-settings form component; wire routing through all 5 touch points listed in finding #5.
3. Sub-part C: implement per whichever option is confirmed (see Unresolved Questions) — if restructure, explicitly update `nav-teacher-consolidation.test.ts`'s assertions as part of this change, not as an afterthought.
4. Run all 4 `nav-*.test.ts` files after sub-part C — if relabel, expect 27/27 unchanged; if restructure, expect the teacher-consolidation test's specific assertions to be intentionally updated (still 27/27 passing, but with different expected values).

## Todo list

- [ ] Confirm P1 committed (it is)
- [ ] Sub-part A: DataTable/ViewSwitcher shadow verification (likely no-op given confirmed findings)
- [ ] Sub-part B: build avatar Menu chrome + bespoke profile-settings-panel + wire all 5 routing touch points
- [ ] Sub-part C: implement per confirmed relabel/restructure decision
- [ ] Run all 4 `nav-*.test.ts` files, confirm pass (with updated assertions if restructure chosen)
- [ ] `pnpm -w typecheck` clean

## Success criteria

- DataTable/ViewSwitcher confirmed flat per P1 doctrine, contract unchanged (P4 depends on this).
- Profile page reachable via a real avatar dropdown menu, matches approved wireframe direction, uses a bespoke form (not force-fit onto RecordDetailPanel).
- Checkin discoverability resolved per the confirmed decision; nav test suite intentionally updated if restructure, unchanged if relabel.

## Risk assessment

- Low for sub-part A (verification-only given confirmed findings).
- Sub-part B is larger than originally scoped (avatar Menu chrome + 5-file routing) but still net-new, low regression risk to existing pages.
- Sub-part C: restructure option carries real risk of touching a deliberately-tested invariant — must be an explicit, acknowledged change to `nav-teacher-consolidation.test.ts`, not a "fix and hope tests still pass" approach.

## Next steps

Once this lands, P4 (CRM cockpit) can safely proceed — it soft-depends on this plan's DataTable/ViewSwitcher interface staying stable, which sub-part A confirms (no contract change, findings show no edit even needed).

## Resolved (was Unresolved)

1. ~~Checkin nav: relabel or restructure~~ — RESOLVED (user, 2026-07-03): relabel only.
