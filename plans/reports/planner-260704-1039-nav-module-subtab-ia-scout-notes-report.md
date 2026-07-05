# Planner scout notes — Nav module + sub-tab IA (Plan D)

Date: 2026-07-04
Plan: plans/260704-1034-nav-module-subtab-ia/

## Verified ground truth (file:line)

- Flat nav render: `apps/admin/src/shell.tsx:549-565` (GroupLabel + leaf SidebarItem loop;
  empty group → null at :551).
- `buildNavGroups`: `shell.tsx:582-716`; 8 groups array `:625-714`; per-leaf `visible()`
  `:595-600` reads `NAV_GATES`. isTeacherOnly `:606`, isBizDirectorOnly `:615`,
  isEduDirectorOnly `:623` — single-role collapse/replace logic.
- Section model: `SectionKey` union `shell.tsx:47-92`; `ALL_SECTION_KEYS` `App.tsx:520-531`;
  `SECTION_TITLES` `shell.tsx:720-761`; `defaultSection` `App.tsx:103-121`.
- View wiring: `switch(activeSection)` `App.tsx:620-883` — 35 cases confirmed. Heterogeneous
  per-panel props: `goToClass`/`selectedSession` (schedule), `oppId` (crm `:789-790`),
  `initialStaffNav` (org `:654`), `studentNav` (students `:658`), facilityId derivations.
- Active-section derivation from URL: `App.tsx:560-574`.
- Search deep-link contract: `SEARCH_GROUPS` `shell.tsx:231-241`; `handleSelectSearchResult`
  `:369-382`; `handleSearchNavigate` `App.tsx:604-616`. CRM opp has a real record URL
  (`/crm/opportunities/:id`); students/staff/classBatches use component-local pre-select.
- Routes: `App.tsx:908-921`.
- Route metadata (build-time static dirs): `link-preview-metadata.ts:102-124`;
  `vite.config.ts:42-59` (`adminRouteMetadataPlugin`, apply:'build').
- Themed Tabs (reuse, do not reinvent): `packages/ui/src/theme.ts:332-355` (underline,
  brand-active).
- In-repo horizontal-tab precedent: `student-management-panel.tsx:16-33` (Mantine Tabs
  consolidating 3 screens for giao_vien-only).
- Nav tests to update: `__tests__/nav-consistency.test.ts` (NAV_GATES↔PERMISSIONS parity +
  D1-D4 guards — UNCHANGED logic, re-run), `nav-teacher-consolidation.test.ts` (calls
  `buildNavGroups` directly, `:29-32` `keysOf` helper), `nav-director-dt-cockpit-consolidation.test.ts`,
  `nav-director-kd-cockpit-consolidation.test.ts`.

## Key architectural finding

The URL never needs to change. The section key already uniquely deep-links each screen; the
module is a pure presentation grouping. Deriving module from section (Option C) delivers the
requested "module → horizontal sub-tab" UX while leaving the search deep-link contract, the
oppId route, and the metadata dirs byte-for-byte intact — collapsing the plan's #1 risk from
High to Low. Recommended over the two-segment path scheme (Option A), which needs a 35-entry
redirect layer + metadata migration for near-zero user benefit.

## Open decisions surfaced to user/red-team

1. URL scheme: Option C (keep flat URL, derive module — recommended) vs Option A (two-segment
   path + redirect layer).
2. Switch vs registry: hybrid (nav-only registry, keep view switch — recommended) vs full
   render registry.

Status: DONE
