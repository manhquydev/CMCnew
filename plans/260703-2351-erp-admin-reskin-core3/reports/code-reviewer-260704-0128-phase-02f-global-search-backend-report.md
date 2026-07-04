# Code Review — Phase 2f Global Search Backend

## Scope
- Files: `apps/api/src/routers/search.ts` (new), `apps/api/test/search-global.int.test.ts` (new),
  `apps/api/src/routers/index.ts` (+2), `apps/admin/src/shell.tsx` (+188/-16)
- Reviewed against: `apps/api/src/routers/class-batch.ts` (RLS pattern), `apps/api/src/routers/user.ts`
  + `packages/auth/src/permissions.ts` (staff-listing authorization precedent),
  `packages/db/src/index.ts` (`withRls`), `packages/auth/src/index.ts` (`rlsContextOf`),
  `packages/db/prisma/migrations/20260623090000_app_user_facility_roster/migration.sql`,
  `packages/db/prisma/schema.prisma` (`AppUser`/`UserFacility`)

## Overall Assessment
RLS mechanics are genuinely correct — all four entity queries run inside a single `withRls` transaction,
no raw SQL, parameterized throughout, one query per entity type (no N+1), `take: 5` enforced on all four.
However, the staff-search leg has a real authorization gap the implementer's own justification does not
hold up under: it conflates facility-level RLS isolation with the codebase's separate, already-established
role-based permission gate for staff-roster visibility.

## Critical Issues

### 1. Staff search bypasses the codebase's existing `user:list` role gate (BLOCKING)
`search.ts` uses `protectedProcedure` for the staff branch (any authenticated user, any role) and queries
`tx.appUser.findMany({ where: { isActive: true, OR: [displayName/email contains] } })` with no permission
check beyond "logged in."

Compare to the existing staff-roster endpoint, `apps/api/src/routers/user.ts`:
```ts
list: requirePermission('user', 'list').query(...)
```
and `packages/auth/src/permissions.ts:284-291`:
```ts
user: {
  list: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  listTeachers: ['giam_doc_dao_tao'],
  listAssignableForAfterSale: ['sale', 'cskh', 'giam_doc_kinh_doanh'],
  ...
}
```
Full co-facility roster visibility (`user.list`) is intentionally restricted to `super_admin` +
the two director roles. Every other role — `giao_vien`, `sale`, `cskh`, `hr`, `ke_toan`, `ctv_mkt` — is
explicitly **not** granted it. `app_user_facility_roster` (the RLS policy the report cites as
justification) only enforces the *facility* boundary at the Postgres level; it does not, and was never
meant to, replace the app-layer role gate — the existence of `requirePermission('user', 'list')` on top of
that same RLS-scoped query in `user.ts` is direct evidence the two layers are deliberately separate.

Net effect: any authenticated staff member (e.g. `giao_vien`, who has no `user:*` permission at all) can
now search-and-enumerate co-facility staff display names and emails through `search.global`, something
they cannot do through `user.list`. This is a real permission-boundary regression, not a style nit — the
report's claim ("No permission ambiguity found... exposes nothing a facility-scoped user couldn't already
see via `user.list`") is factually wrong: a `giao_vien` cannot call `user.list` at all (403), so this
endpoint exposes *more* than that user could previously see.

Fix: gate the staff branch behind the same permission set already used for staff-lookup UIs (e.g. reuse
`requirePermission('user', 'list')`-equivalent role list, or at minimum restrict which roles receive a
non-empty `staff` group in the response — do not silently drop the whole procedure to
`superAdminProcedure`, since directors/HR/sale-assign flows legitimately need it). If product intent is
"any staff can search any staff in their facility," that's a scope decision that reverses an existing
authorization choice and should go back to the user per the review-and-audit rule on user decisions, not
be resolved unilaterally in this sub-phase.

## High Priority

### 2. `facilityId` narrowing param silently ignored for staff results
Students/opportunities/classBatches all spread `...facilityWhere` (`{ facilityId: input.facilityId }`)
into their `where`. The staff query does not — `AppUser` has no direct `facilityId` column (it's
many-to-many via `UserFacility`), so the same one-liner doesn't apply. Not a security bug (RLS still
scopes staff results to the caller's own facility set), but it is a silent inconsistency: a multi-facility
director who explicitly passes `facilityId: 3` to narrow results will still get staff from *all* their
facilities mixed in, while students/opportunities/classes correctly narrow to facility 3 only. Should
either filter staff via `facilities: { some: { facilityId: input.facilityId } }` or document the
asymmetry in a comment (currently undocumented).

## Medium Priority

### 3. Test suite: cross-facility isolation only covered for `students`
`search-global.int.test.ts` has one RLS-isolation test (`does not leak a cross-facility student...`)
but no equivalent for `opportunities`, `staff`, or `classBatches`. Since all four go through the same
`withRls` wrapper the mechanism is almost certainly the same, but for a facility-isolation-critical
endpoint, asserting it once and inferring the rest is a coverage gap worth closing — especially for
`staff`, given the permission issue above compounds the risk if RLS is ever weakened.

## Low Priority / Confirmed Non-Issues

- **RLS correctness (item 1 of prompt)**: verified — all four `findMany` calls execute on the `tx` handle
  bound inside the single `withRls(rlsContextOf(ctx.session), ...)` transaction (`search.ts:49-110`); no
  query escapes it, no `$queryRaw`/`$queryRawUnsafe` used for the search predicates themselves (only
  `withRls`'s internal `set_config` call uses `$executeRawUnsafe`, and that's parameterized).
- **Input validation (item 3)**: `q: z.string().max(200)`, no `.min()` — `q.trim().length < 2` returns
  `EMPTY_RESULT` before any DB call, not a 400. Matches the report's description exactly.
- **SQL injection (item 4)**: no raw SQL in the search predicates; Prisma `contains`/`mode: 'insensitive'`
  throughout — parameterized by the query builder.
- **N+1 (item 5)**: exactly 4 queries via `Promise.all`, one per entity type; the guardian-phone match
  (`guardians.some.parent.phone`) is a single relational filter, not a per-student loop.
- **Result limit (item 6)**: `take: RESULT_LIMIT` (5) present on all four `findMany` calls.
- **shell.tsx navigation claim (item 7)**: verified against the diff — students/staff/classBatches route
  through `onSectionChange(group.section)` (a real, existing section, not a no-op); only CRM opportunities
  get a true deep link via `useNavigate('/crm/opportunities/:oppId')`, matching the report's description.
- **shell.tsx scope (item 8)**: diff is scoped to the search wiring only — bell/avatar/logout code
  untouched (`git diff` confirms only new `GlobalSearchDropdown`/search state/`Popover` additions).
- **Debounce (item 9)**: real `useDebouncedValue(searchQuery, 300)` from `@mantine/hooks`, gates the
  `useEffect` that fires the query — not per-keystroke.
- **`routers/index.ts`**: clean 2-line registration, no scope creep.

## Recommended Actions
1. **Blocking**: Add a role/permission gate to the staff branch of `search.global` (or split staff out of
   the shared procedure into its own permission-checked path) before this ships. Confirm with the user
   whether "any staff can search co-facility staff" is an intentional scope change to the existing
   `user:list` restriction, or fix it to respect the existing gate.
2. Apply `facilityId` narrowing to the staff query via the `facilities` relation, or document why it's
   intentionally omitted.
3. Add cross-facility isolation tests for `opportunities`, `staff`, `classBatches` (mirror the existing
   student test).

## Task Completeness
Phase 2f's other stated requirements (RLS-scoped queries, per-entity limit 5, min-2-char autosuggest
behavior, 300ms debounce, grouped dropdown, CRM deep-link reuse) are implemented as described and verified
correct. The student/staff/class-batch deep-link gap is honestly flagged by the implementer as a scoped
follow-up (confirmed accurate against `shell.tsx`) and is not itself a defect — real UX gap, correctly not
silently worked around. The staff-permission issue above is the one item that needs resolution before this
sub-phase can be marked complete.

## Unresolved Questions
- Product decision needed: should facility-scoped global search expose staff name/email to every
  authenticated role, or should it inherit the existing `user:list` role restriction (super_admin +
  2 director roles, ± the narrower assign-picker roles)? This determines the fix shape for Critical Issue 1.
