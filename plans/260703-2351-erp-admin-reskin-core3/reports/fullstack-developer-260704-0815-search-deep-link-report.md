# Search deep-link report — students/staff/classBatches

## Status
DONE_WITH_CONCERNS (see Concerns/Blockers — verification could not run this session)

## Scope
Extended global-search click-through so all 4 entity types (students, staff, classBatches, CRM
opportunities) navigate to the exact record, not just the list section. CRM already worked (URL
route). The other 3 now use the same "pre-select via component-local state" mechanism that
`goToClass`/`navAction` already established for classes.

## Files touched (exactly 3, no others)
- `apps/admin/src/shell.tsx`
- `apps/admin/src/App.tsx`
- `apps/admin/src/students-panel.tsx`

## Changes

### shell.tsx
- Updated the stale doc comment above `SEARCH_GROUPS` (previously said students/staff/classBatches
  are "not externally selectable" — no longer true).
- `Shell` now takes a required `onSearchNavigate(entityKey: 'students'|'staff'|'classBatches', id: string)`
  prop.
- `handleSelectSearchResult`: if `group.path` exists (opportunities) → `navigate(path)` as before.
  Else if the group key is one of the 3 new ones → calls `onSearchNavigate(key, id)`. Else (should
  be unreachable now) falls back to the old `onSectionChange(group.section)` as a safety net.

### App.tsx
- Added `export interface SearchNavAction { id: string; ts: number }` — same `ts`-timestamp
  re-trigger trick as `class-workspace.tsx`'s existing `NavAction`, so clicking the same search
  result twice in a row still re-opens the detail view.
- `Dashboard`: added `studentNav`/`staffNav` state (both `SearchNavAction | null`).
- Added `handleSearchNavigate(entityKey, id)`:
  - `classBatches` → reuses the **existing** `goToClass(id, 'sessions')` call as-is (zero new
    plumbing, per the plan's prediction — this was the easy one).
  - `students` → sets `studentNav` + `navigate('/students')`.
  - `staff` → sets `staffNav` + `navigate('/org')`.
- `handleSectionChange` now also clears `studentNav`/`staffNav` (mirrors how it already clears
  `navAction`), so navigating away via the sidebar doesn't leave a stale pending selection.
- `case 'students'` → `<StudentsPanel initialDetailId={studentNav} />`.
- `case 'org'` → `<OrgPanel initialStaffNav={staffNav} />` (new prop on the local `OrgPanel`
  function).
- `OrgPanel`: added `initialStaffNav` prop + a `useRef`-guarded `useEffect` that looks up the user
  in the already-loaded `users` array and calls the existing `setViewing(found)` once found. The
  effect depends on `[initialStaffNav, users]`, so it naturally waits for the async `loadUsers()`
  fetch (fired in `OrgPanel`'s mount effect) to complete before the id can be found — no need for a
  separate loading-state check.
- `<Shell>` call site now passes `onSearchNavigate={handleSearchNavigate}`.
- Added `useRef` to the React import list (previously only `useCallback, useEffect, useMemo, useState`).

### students-panel.tsx
- `StudentsPanel` now accepts an optional `initialDetailId?: { id: string; ts: number } | null`.
- A `useRef`-guarded `useEffect` seeds `detailStudentId` from `initialDetailId.id` when `ts` changes,
  identical pattern to `class-workspace.tsx`'s `Workspace` consuming `navAction`.
- Added `useRef` to the React import list.

## Why classBatches needed no new plumbing
`Workspace`'s `navAction` (batchId + tab) already supports "open workspace with this batch
pre-selected" — this is exactly what `schedule-panel.tsx`/`schedule-detail.tsx` already do via
`goToClass(batch.id, 'sessions')`. The new `handleSearchNavigate` for `classBatches` just calls the
same `goToClass` function with the search result's id and the same `'sessions'` tab used elsewhere.

## Constraints honored
- No backend changes; `search.ts` untouched.
- No new tRPC calls added — `StudentsPanel`/`StaffProfilePanel`/`Workspace` all already fetch their
  own detail data (`trpc.student.get`-backed `StudentDetailPanel`, `trpc.user.list` already loaded
  into `OrgPanel`'s `users` state, `Workspace`'s own batch fetch) — only an id is now pre-seeded.
- `finance-panel.tsx`, `opportunity-detail.tsx` untouched.
- Existing navigation (sidebar clicks, manual list-row clicks) unchanged: `handleSectionChange`
  (sidebar) and each panel's own click-to-select-a-row flow are untouched code paths; the new
  `initialDetailId`/`initialStaffNav` props are purely additive and only populated by the new
  search-navigate path.

## Tests / verification
- **Could not run `pnpm -w typecheck` / `pnpm --filter @cmc/admin test`** — the Bash tool in this
  session fails on every command (including `echo hello`) with a persistent shell-quoting error,
  confirming the task's own warning that Bash is broken. No separate PowerShell tool was exposed to
  me in this agent invocation (only `Bash` is in my toolset), so I could not execute the
  verification commands at all this session.
- Compensated with manual code-path review instead:
  - Confirmed `Shell` has exactly one call site (`App.tsx`), so the new required
    `onSearchNavigate` prop doesn't break any other caller.
  - Confirmed no test file references `shell.tsx`'s `Shell`/`GlobalSearchDropdown`,
    `students-panel.tsx`'s `StudentsPanel`, or `App.tsx`'s `OrgPanel` — the 4 existing admin test
    files (`nav-*.test.ts`) only import `buildNavGroups`/`SectionKey`, both untouched.
  - Traced id types end-to-end: `search.ts`'s `staff: staff.map((u) => ({ id: u.id, ... }))` and
    `students: [...]`/`classBatches: [...]` all use Prisma cuid `id` fields (string), matching
    `User.id`/`StudentT`/batch `id` types already used elsewhere in these same files (e.g.
    `detailStudentId: string | null`, `goToClass(batchId: string | undefined, ...)`), so no type
    mismatch is expected.
  - Re-read every edited region after editing to confirm the diffs are syntactically complete
    (braces/parens balanced, imports added for `useRef` in both `App.tsx` and `students-panel.tsx`).

## Concerns/Blockers
- **Unverified build**: typecheck/lint/test were not actually executed this session due to the
  broken shell tool. Please run `pnpm -w typecheck` and `pnpm --filter @cmc/admin test` before
  merging to catch anything the manual review missed.
- Staff deep-link (`OrgPanel`) silently no-ops if the searched-for user id is never found in the
  loaded `users` list (e.g. a permission edge case where search returns an id the current user's
  `user.list` call wouldn't include) — this mirrors the plan's requested "seed from existing local
  state" approach rather than adding a new `trpc.user.get` call, but it means that edge case fails
  silent-list-only rather than showing an error. Flagging as an accepted trade-off per the "reuse
  existing data-fetching, no new endpoints" constraint — happy to add an explicit not-found toast
  if desired.
- None of the 3 entity types required a harder/partial/fallback treatment — students and staff got
  the full "pre-select via local state" treatment as planned, and classBatches turned out to need
  zero new plumbing (reused `goToClass` verbatim).

## Unresolved questions
- Should teacher-only accounts get a different destination for a `students` search result (their
  nav hides the standalone `/students` route in favor of `/student-mgmt`, which currently only
  wraps `Workspace`/classes, not a student-detail view)? I kept the behavior identical to the
  pre-existing fallback (always navigate to `/students` regardless of role) since that matches
  today's behavior before this change and no student-detail surface exists inside
  `student-mgmt` to redirect to instead.
