# Phase 04 — Parent self-service — completion report

## Status: DONE

## Summary

Implemented parent profile self-edit + staff-reviewed self-link request flow per
`plans/260702-1109-lms-engagement-rewards-admin/phase-04-parent-self-service.md`.
Anti-takeover invariant holds: the parent-facing `requestLink` path never writes to
`Guardian` — only the staff `linkRequestReview` approve path does (integration-tested,
zero-Guardian-rows assertion is the first test in `guardian-link-request.int.test.ts`).

## Files modified

- `packages/db/prisma/schema.prisma` — added `GuardianLinkRequestStatus` enum,
  `GuardianLinkRequest` model, `ParentAccount.linkRequests` back-relation.
- `packages/db/prisma/migrations/20260702152400_guardian_link_request/migration.sql` — new
  migration: table/enum DDL (from `prisma migrate dev --create-only`) + hand-written RLS SQL
  (function `app_account_id()`, `guardian_link_request_isolation` policy, and an **updated**
  `parent_account_staff_rw` policy that adds a `parent`-self-row clause).
- `packages/db/src/index.ts` — `RlsContext` gained an optional `accountId`; `withRls` now sets
  a 5th GUC `app.account_id` (sanitized to `''`/SQL NULL on non-uuid input rather than throwing,
  see Deviations).
- `packages/auth/src/lms.ts` — `lmsRlsContextOf` forwards `s.accountId` into the new GUC.
- `packages/auth/src/permissions.ts` — added `guardian.linkRequestList` /
  `guardian.linkRequestReview` → `['giam_doc_kinh_doanh', 'giam_doc_dao_tao']`.
- `apps/api/src/routers/guardian.ts` — 3 parent procedures (`profileUpdate`, `requestLink`,
  `linkRequestListMine`) + 2 staff procedures (`linkRequestList`, `linkRequestReview`).
- `apps/admin/src/guardians-panel.tsx` — `LinkRequestQueue` component (approve/reject +
  candidate picker for ambiguous matches), mounted above the existing student/parent linker.
- `apps/lms/src/parent-view.tsx` — new `'profile'` tab in `ParentTab`; `ProfileTab` component
  (profile edit form + link-request form + own-requests list). Rendered as an early branch in
  `ParentView` **before** the "zero children" guard, since profile/link-request must stay
  reachable for a parent with no linked children yet.
- `apps/lms/src/parent-shell.tsx` — added `profile` to `PARENT_NAV` and `ALL_PARENT_TABS`.
- `apps/api/test/fixtures/permission-snapshot.json` — added the 2 new registry rows (parity test).
- `apps/api/test/guardian-link-request.int.test.ts` (new) — 13 tests, all against the real dev
  Postgres RLS (no mocks).

## Tests

- `pnpm --filter @cmc/api typecheck` — clean.
- `pnpm --filter @cmc/admin typecheck` — clean.
- `pnpm --filter @cmc/lms typecheck` — clean.
- `pnpm --filter @cmc/db typecheck` / `@cmc/auth typecheck` — clean.
- `prisma migrate diff --from-schema-datamodel ... --to-schema-datasource ... --exit-code` →
  **No difference detected** (0-drift, checked both right after `migrate dev` and again after
  the later `withRls` code fix).
- New suite `guardian-link-request.int.test.ts`: **13/13 pass**, covering:
  - `profileUpdate` own-row scope (A cannot touch B), email-collision → `BAD_REQUEST` not 500.
  - `requestLink` anti-takeover: zero `Guardian` rows created by the parent path.
  - Unique `studentCode` match → `facilityId` resolved at request time, visible to that
    facility's director via RLS.
  - Ambiguous match (one registered guardian phone linked to 2 students) → `facilityId` null,
    surfaced only in `linkRequestList`'s global unresolved bucket with 2 `candidates`.
  - Generic response regardless of match/no-match (no oracle).
  - Rate limit: 5 calls OK, 6th `TOO_MANY_REQUESTS`, both per-accountId and per-IP.
  - `linkRequestListMine` returns only the caller's own rows.
  - `linkRequestReview` approve → exactly one `Guardian`, row closed `approved`; reject → zero
    `Guardian`, row closed `rejected`.
  - Role gate: `giao_vien` → `FORBIDDEN` on `linkRequestList`.
- Full `apps/api` suite (`npx vitest run`, 109 files / 625 tests): **624 pass, 1 pre-existing
  unrelated failure** (`email-graph-client.test.ts` — OTP email subject template, last touched
  in commit `6b2a862`, untouched by this phase; confirmed failing for reasons unrelated to RLS/
  guardian code).
- Regression-checked in particular: `guardian-principal-isolation.int.test.ts` (26 tests, the
  existing G1–G6 parent-RLS matrix) — all still pass after the `parent_account` policy change
  and the new `accountId` GUC.
- Manual UI: not run in a browser (no dev server started this session); typecheck-only per the
  agent's stated scope note below. Recommend a manual smoke pass before shipping the plan's
  overall Phase 5 validation.

## Deviations / judgment calls (documented per plan's "make a reasonable KISS call" note)

1. **New `app.account_id` GUC** (not explicitly listed in "Files you may modify", but
   `packages/db/src/index.ts` / `packages/auth/src/lms.ts` are the only place this security
   requirement — "parent reads/creates only own rows" — can be implemented; no existing GUC
   carried the LMS principal's own account id). Extended `RlsContext` with an optional field
   and one more `set_config`; fully backward compatible (`undefined` → `''` → SQL NULL, matches
   nothing, same as before for every caller that doesn't pass it).
2. **`parent_account_staff_rw` policy extended, not replaced** — added a
   `(principal_kind = 'parent' AND id = app_account_id())` OR-clause to the existing
   staff-only identity policy so `profileUpdate` can read/update the caller's own row. Staff
   access is unchanged; parents still cannot list/read other parents.
3. **`withRls` accountId validation is sanitize-not-throw**, unlike `studentIds`/`facilityIds`
   (which throw on malformed input). Discovered during the full-suite run: several pre-existing
   test fixtures build a raw `LmsSession` with a placeholder non-uuid `accountId` (e.g.
   `'test-account'`) for endpoints that have nothing to do with `parent_account`/
   `guardian_link_request`. A hard throw there broke 8 unrelated test files (submission,
   schedule, rewards, enrollment, lms-security-invariants). Fixing every such fixture felt like
   scope creep for a low-risk field, so `withRls` now sanitizes a non-uuid `accountId` to `''`
   (→ SQL `NULL`, matches nothing — fails closed, never crashes). A malformed value can only
   ever be a bug in test fixtures or trusted server code (this field is never client input), so
   fail-closed-silently is an acceptable trade vs. throwing.
4. **`linkRequestReview` input got an extra optional `studentId`** beyond the plan's literal
   `{ id, decision, relation?, reason? }` — the plan text says approve must "resolve student" but
   ambiguous requests (per M2's own risk table) require staff to pick an explicit candidate at
   review time, and there was no field carrying that pick. Used `reqRow.matchedStudentId ??
   input.studentId`, `BAD_REQUEST` if neither is present. This is additive or the ambiguous-case
   flow would be dead code.
5. **`linkRequestList`'s facility scoping is permission-gated, not RLS-role-gated**: RLS only
   knows `principal_kind`/`facility_ids`, not "director" vs "teacher" among staff. The
   director-global unresolved bucket (`facility_id IS NULL`) is visible to any `staff` principal
   under RLS, but `requirePermission('guardian', 'linkRequestList')` restricts the *procedure*
   to the two director roles — matches the plan's own risk-table note that this is "not the
   cross-parent-read hard gate" since no student PII is resolved for those rows.
6. **Approve never rewrites `facility_id` on the request row** (even when resolving an
   ambiguous match to an explicit student) — kept the request's own `facilityId` field as
   originally captured at request time (null stays null after approval). This sidesteps a
   `WITH CHECK` edge case (a staff director without that facility approving into it) and the
   field is purely advisory metadata about the request itself once `status` is closed; the
   `Guardian` row created on approve carries the correct resolved `facilityId` independently.

## Unresolved questions

- None blocking. If the orchestrator wants `linkRequestReview`'s ambiguous-candidate UX changed
  (e.g. force staff to always pass an explicit `studentId`, even for unambiguous matches, for a
  stricter audit trail), that's a 1-line schema tweak in the router, not a redesign.
