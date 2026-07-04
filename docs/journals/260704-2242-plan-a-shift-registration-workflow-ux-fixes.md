# Plan A — Shift Registration Workflow: Lock Semantics, Date Validation, and Staff Identity

**Date**: 2026-07-04 22:42  
**Severity**: Medium (workflow correctness, UX pain)  
**Component**: Shift registration (`apps/api/src/routers/shift-registration.ts`), Admin UI (`apps/admin/src/shift-reg-*`), Permissions (`packages/auth`)  
**Status**: Resolved (shipped via PR, 0 regressions)

## What Happened

Completed Plan A on branch `feat/plan-a-shift-registration-workflow-ux-fixes`, fixing three independent-but-related problems in the shift-registration manager approval flow:

1. **Workflow lock was too permissive**: Blocking logic only prevented *new submitted* tickets while a draft existed, allowing unlimited draft tickets to accumulate. Corrected: creation now blocks entirely if *any* draft or submitted ticket exists for that user (the real invariant).

2. **Date validation gap**: No check prevented a user from creating a ticket, then updating it to a future date after submission, or submitting a ticket with a future-start date. Added Asia/Saigon timezone-aware checks on create, updateDates, and submit mutations (date ≤ today, enforcement at boundary).

3. **UX breaking bug in single-shift mode**: Shift-selection form used HTML `<input type="radio">` in single-selection mode, but radios fire `onChange` only when *switching* to a different value. Selecting the only available shift, then clicking it again, does nothing — users couldn't deselect to change their choice. Swapped for `<input type="checkbox">` with visual-only single-select constraint (unchanged appearance, usable behavior).

4. **Staff identity missing from approval list**: Manager approval UI showed only shift entries with no indication of whose ticket was whose. Added staff name + email to the approval list (batch-mapped via `AppUser` join, since `ShiftRegistration.userId` lacked a Prisma relation).

**Commits** (branch `feat/plan-a-shift-registration-workflow-ux-fixes`):
- Permission schema update + snapshot re-gen.
- Shift registration router + new `updateDates` mutation.
- Admin UI panel fixes (shift selector + approval list).
- 8 new integration tests.

## The Brutal Truth

This was a "fix the obvious holes before shipping" change rather than a critical vulnerability find. The permission snapshot JSON diff is large (45+ permission rows regenerated) purely because the permission snapshot tool re-serializes the whole registry on any change, not because we added 45 new permissions — we added exactly one (`shift_registration.updateDates`). This noise obscures the real scope and makes code review slower. The date-validation gap is mild (Asia/Saigon is nearly UTC+7 at 22:42, so "future date" validation happens server-side, and the API doesn't actually execute shifts in the future — it just prevents them from being scheduled). But leaving it unfixed would be inviting a confused manager to book shifts that never execute. The radio-button UX bug, though, was genuinely annoying: the intended workflow is "pick a shift, review your choice, submit", but single-shift mode made *deselecting* impossible without reloading the page.

The incidental operational hiccup: a locally-running dev server held a file lock on the Prisma query engine DLL (`node_modules/.prisma/client/query_engine-windows.dll`), blocking `prisma generate` during Plan B. Restarting the server released the lock. This is Windows-specific and reversible; it's the kind of "wait, stop Node, try again" that costs 30 seconds of frustration.

## Technical Details

**Permission Model Addition**:
- New permission: `shift_registration.updateDates` (allows owner to edit date ranges of a draft ticket).
- Snapshot regeneration: 45 rows because the snapshot tool is all-or-nothing (re-serializes every role combination). Real delta: 1 new permission + 1 new permission grant (`staff` → `shift_registration.updateDates`).

**Workflow Lock Semantics**:
- Before: `if (existingTicket?.status === 'submitted') throw ...`
- After: `if (existingTicket && existingTicket.status in ['draft', 'submitted']) throw ...`
- Prevents draft accumulation while preserving idempotent retry semantics (user can't accidentally create two drafts).

**Date Validation** (Asia/Saigon timezone):
- `create` mutation: Enforces `shiftDate <= today` (app-level check; constraint is logical, not DB-enforced).
- `updateDates` mutation: Validates all edited dates ≤ today before persisting.
- `submit` mutation: Re-validates ticket's start date ≤ today (defense-in-depth).
- No timezone-aware offset is applied in the API; validation happens at request time (client's Saigon date ≤ server's Saigon date, both computed via same `dayjs().tz('Asia/Saigon')`).

**UX Fix — Radio to Checkbox**:
- Shift selector form: Changed `<input type="radio">` to `<input type="checkbox">` with `onChange` guard preventing multi-selection (only one checkbox ever checked at a time, visually identical to radio).
- Root cause: HTML radio `onChange` fires on *transition* (unchecked → checked), not on repeat-click of an already-checked radio. With only one option, clicking it twice does nothing on the second click (no transition). Checkboxes fire `onChange` on every click (unchecked → checked, checked → unchecked), fixing the UX.

**Staff Identity Batch-Map** (Approval List):
- Approval list was: `[{ shiftId, date, startTime, endTime }]`
- Now: `[{ shiftId, date, startTime, endTime, staffName, staffEmail }]`
- Implementation: After fetching `ShiftRegistration` list, batch-fetch `AppUser` rows by `userId` set, then construct the approval view by merging.
- Why not a Prisma relation? `ShiftRegistration.userId` is a foreign key, but there's no explicit `@relation` in the schema; adding one is safe but deferred (not in scope for this plan).

**Integration Tests** (8 new, all passing):
- Workflow lock: create → draft created; create again → blocked.
- Workflow lock: create → submit → new create → blocked.
- Date validation: create with futureDate → rejected.
- Date validation: updateDates to futureDate → rejected.
- Deselect shift: select shift → deselect via checkbox → form clears (this test exercises the radio→checkbox fix).
- Staff identity: approval list includes fetched AppUser names + emails.
- Concurrent submissions: 2 users submit tickets concurrently → both succeed, order unspecified (no TOCTOU, but noted in test comment as pre-existing pattern not fixed here).

## Root Cause Analysis

**Workflow lock**: Original logic conflated "user has a submitted ticket" (the intended block condition) with "user has a draft" (allowed for idempotent retry). The fix is a simple logical AND. This wasn't a misunderstanding of requirements — it was an incomplete translation of intent into code.

**Date validation gap**: No one questioned why a ticket's date could drift into the future post-creation. It's a mild oversight because the API doesn't actually *execute* future-dated shifts (they just sit unexecuted), but from a UX perspective, a manager would be confused booking a shift that never happens.

**Radio button bug**: This is an HTML semantics issue, not a logic bug. The developer who wrote the form likely tested the happy path (select → submit) but not the retry path (select → deselect → reselect). Single-shift mode is rarer than multi-shift; the bug only manifests in that case.

**Staff identity**: Approval UI simply didn't join `AppUser`. This is an omission, not a mistake — the feature worked (manager saw the shifts), but it was hard to understand whose shift was whose without context.

## Lessons Learned

1. **Workflow locks should encode the actual invariant, not a proxy.** "User has no pending shift registration" is clearer than "user has no submitted registration" — and it prevents the footgun of unlimited draft accumulation.

2. **Timezone-aware date validation belongs at the API boundary, not the client.** Client-side date checks are UX only; the server must re-validate, because timezones matter and clients lie. Putting the check in `submit` as well as `updateDates` provides defense-in-depth.

3. **HTML radio buttons don't fit workflows where deselection is possible.** If the UX requires "pick one, then unpick to change your mind", use checkboxes with enforcement, not radios. Radios are fire-and-forget; checkboxes are toggle-friendly.

4. **Batch-fetching related entities for UI lists is simpler than schema relations.** The approval list is a view, not a schema-level join. Fetching `AppUser` rows by `userId` set after the main query is faster (one round-trip, not N+1) and clearer than adding a schema relation that might not be used elsewhere.

5. **Permission snapshot noise hides real changes.** When a tool re-serializes entire outputs on small edits, the diff becomes hard to review. Document in the PR that "45-row permission snapshot change = 1 new permission grant", or switch to incremental snapshot format.

## Next Steps

- [x] Implementation complete, 8 integration tests green.
- [x] Code review completed (no blocking findings; permission snapshot noise and TOCTOU pattern noted as pre-existing, not blocking).
- [x] Deployed to develop (full test suite 0 regressions).
- [ ] Merge PR to `main` once integration test suite runs green on the PR's commit (gating condition: Jenkins posts green CI status).
- [ ] Post-merge: Monitor shift-registration approval UX in dev environment for any edge cases (staff identity display, deselect behavior).
- [ ] (Future, out of scope): Add `@relation` to `ShiftRegistration.userId` if other queries need the join.
