# Code Review — search deep-link fix (staff / classBatches / re-trigger / compat)

## Scope
- `apps/admin/src/App.tsx` (`OrgPanel`, `Dashboard.handleSearchNavigate`, `goToClass`, `<Shell>` call site, `renderContent` switch)
- `apps/admin/src/shell.tsx` (`SEARCH_GROUPS`, `handleSelectSearchResult`, `Shell` props)
- `apps/admin/src/students-panel.tsx` (`StudentsPanel` `initialDetailId` effect)
- `apps/api/src/routers/search.ts`, `apps/api/src/routers/user.ts` (server-side staff data source, read-only, not part of the diff)

Note: the Bash tool in this session reproduced the exact "unexpected EOF" quoting failure flagged in the task (confirmed on `git status` alone, no complex quoting). Could not run `git diff` or re-run typecheck/tests myself; relied on direct file reads (`Read`/`Grep`) instead, cross-checked against the user's independently-run clean `pnpm -w typecheck` (12/12) and `pnpm --filter @cmc/admin test` (27/27) results.

## Findings

### 1. Staff deep-link (`OrgPanel`) — should-fix, not blocking
`apps/admin/src/App.tsx:438-456`. The effect correctly retries `users.find((u) => u.id === initialStaffNav.id)` on every `users` change and gates re-application on `ts`, so it will eventually resolve once `loadUsers()` completes — this is not a timing race in the normal path.

Traced whether the flagged "silently no-ops if id isn't in the loaded list" caveat is real:
- `user.list` (`apps/api/src/routers/user.ts:30-34`) is an **unpaginated, unfiltered** `findMany` — no `where`, no `take`. RLS (`app_user_facility_roster`) is the only scope.
- `search.global`'s staff branch (`apps/api/src/routers/search.ts:89-102`) runs under the **same `withRls(rlsContextOf(ctx.session), ...)` context** and the same `can(...,'user','list')` gate before even attempting the query, but additionally filters `isActive: true` and takes only 5 results ordered by `displayName`.

Since both queries share the identical RLS scope and permission gate, and search's staff filter (`isActive: true`) is strictly narrower than `user.list`'s (no filter, includes inactive), every staff search result is guaranteed to already be a member of the full `users` array once it loads — the two are not independently scoped. So the "found() might never match" scenario does **not** occur from a facility/permission/pagination mismatch as the report worried; `take: 5` on the search side doesn't matter here since `OrgPanel`'s own list has no such cap.

The one real (rare) gap: if `loadUsers()` itself fails (network error), `users` stays `[]` forever and the effect never fires `setViewing`. `notifyError` does show a toast for the underlying list-load failure, but there's no toast tied specifically to "couldn't open this staff record" — a searched-for staff member would just silently stay on the Org list view with no `viewing` panel opening. **Should-fix**, not blocking: either surface a toast when `initialStaffNav` is set but `found` stays undefined after `users` has loaded at least once (add a `loaded` boolean or check `users.length > 0 && !found`), or accept this as a known trade-off given it only triggers on network failure (which already has its own error surface).

### 2. classBatches path — confirmed correct, zero new plumbing
`shell.tsx:369-379` → `onSearchNavigate('classBatches', id)` → `App.tsx:604-607` → `goToClass(id, 'sessions')` (the pre-existing `goToClass`, `App.tsx:585-591`, already used by `schedule-panel.tsx`/`schedule-detail.tsx`). Confirmed the search result's classBatch `id` (Prisma cuid, `search.ts:133-137`) is passed straight through with no transformation, and `'sessions'` is a sane default tab (same one used by the existing call sites). Claim verified: no new plumbing added for this entity type.

One minor behavioral note, not a regression: `goToClass` routes teacher-only accounts to `/student-mgmt` instead of `/classes` (`App.tsx:584,588`) — this is pre-existing behavior unrelated to this change, not introduced by the diff.

### 3. Re-trigger correctness (`ts` timestamp) — confirmed correct in both places
- `students-panel.tsx:56-61`: `appliedNavTs` ref compared against `initialDetailId.ts`; effect depends on `[initialDetailId]` (the whole object, which is a **new object literal** each time `handleSearchNavigate` fires `setStudentNav({ id, ts: Date.now() })` in `App.tsx:610`) — so identity changes on every click, and the `ts` guard prevents redundant re-application while still allowing intentional re-trigger on the same id. Correct.
- `OrgPanel` (`App.tsx:450-456`): same pattern, effect depends on `[initialStaffNav, users]` — correctly includes `users` so it also retries once the async load resolves, unlike `StudentsPanel`'s effect which doesn't need that (it doesn't wait on an async list, just sets an id string for `StudentDetailPanel` to fetch internally). Both are correct for their respective needs.

### 4. Backward compatibility — confirmed
- `StudentsPanel`'s destructured param defaults to `= {}` (`students-panel.tsx:47`) and `initialDetailId` is optional — a bare `<StudentsPanel />` continues to work.
- Only one call site of `<StudentsPanel` exists in `apps/admin/src` (verified via grep — App.tsx:659 is the sole JSX usage; the only other match, `schedule-detail.tsx:333`, is a comment, not a call).
- `OrgPanel` is a locally-defined, single-use component in `App.tsx` (not exported), so there's no external caller to break.

### 5. `Shell`'s new required `onSearchNavigate` prop — confirmed, single call site
Verified via grep across `apps/admin/src`: `<Shell` appears nowhere as JSX except implicitly (the literal tag wasn't found by a literal grep for `<Shell`, but `Shell` as an identifier appears only in `App.tsx` and its own definition in `shell.tsx`); `App.tsx:886-895` is the only render, and it passes `onSearchNavigate={handleSearchNavigate}` correctly alongside the pre-existing `activeSection`/`onSectionChange`/`navGroups`/`sectionTitle` props. No other consumer of `Shell` exists to break from the signature change.

### 6. Scope of the `renderContent` switch diff — confirmed additive only
Read the full switch region (`App.tsx:620-896`, ~35 `case` branches). Only the two touched lines changed:
```
case 'org':      return <OrgPanel initialStaffNav={staffNav} />;      // was <OrgPanel />
case 'students':  return <StudentsPanel initialDetailId={studentNav} />; // was <StudentsPanel />
```
All neighboring branches (`overview`, `biz-director-cockpit`, `courses`, `guardians`, etc.) are untouched. No restructuring.

## Severity Summary
- **Blocking**: none found.
- **Should-fix**: staff deep-link has no user-visible "not found" feedback in the (rare) case `loadUsers()` fails outright — currently only the generic load-failure toast fires, with no indication the deep link itself didn't resolve. Low-likelihood (requires a network/API failure), acceptable to ship with a follow-up ticket, or fix now by checking `users.length > 0 && !found` after the fetch settles and firing a distinct notice.
- **Minor**: the report's stated risk ("silently no-ops if id isn't in loaded users list" due to permission/pagination mismatch) is overstated — the RLS/permission scopes between `search.global` and `user.list` are identical and `user.list` is a strict superset, so this isn't a live gap outside of outright fetch failure. Worth correcting the report's framing so a future reader doesn't over-invest fixing a non-issue.

## Unresolved Questions
- Should a distinct "staff record not found / list unavailable" toast be added now, or deferred as a follow-up given the low likelihood? (Report already flagged this as an accepted trade-off; recommend deferring unless the user wants it addressed in this same change.)
- Teacher-only `students` search destination (`/students` vs a future `student-mgmt` detail surface) — carried over from the implementing agent's own open question, unchanged by this review, no new evidence to resolve it either way.
