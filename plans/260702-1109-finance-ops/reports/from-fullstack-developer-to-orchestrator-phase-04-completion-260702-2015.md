# Phase 4 — Discount-Tier Config UI — Completion Report

## Executed Phase
- Phase: phase-04-discount-tier-ui
- Plan: plans/260702-1109-finance-ops
- Status: completed

## Files Modified
- `apps/api/src/routers/finance.ts` — added `discountTierList`, `discountTierUpsert`, `discountTierArchive` procedures (+~65 lines); no other section touched. Imported `DISCOUNT_CAP_PERCENT` from `@cmc/domain-finance` alongside existing imports.
- `packages/auth/src/permissions.ts` — added 3 perms under `finance:` (`discountTierList`/`discountTierUpsert`/`discountTierArchive`, all `['giam_doc_kinh_doanh']`).
- `apps/admin/src/finance-panel.tsx` — added `DiscountTierCard` component (~185 lines) and mounted it in `FinancePanel`'s `Stack` between `VoucherCard` and `ReceiptCreateCard`. Did not touch Phase 1's refund UI or any other existing section.
- `apps/api/test/discount-tier-config.int.test.ts` — new integration test file, 4 tests covering all 5 acceptance criteria (a–e; (a)+(d) combined into one test for reasons below).
- `apps/api/test/fixtures/permission-snapshot.json` — added the 3 new snapshot entries (required by `permission-parity.test.ts`'s "no silent additions" check).

## Tasks Completed
- [x] perms + CRUD router (upsert on unique, archive soft) + audit (`logEvent` on every write)
- [x] server-side 35% cap from `@cmc/domain-finance` (`DISCOUNT_CAP_PERCENT`, not re-declared)
- [x] config UI (table + capped form + archive + defaults banner)
- [x] repricing sanity check — proven via integration test, not just manual check (stronger than the plan's Step 4 ask)

## Key correctness detail (as briefed)
`discountTierUpsert` upserts on `@@unique([facilityId, years])`, which spans archived rows: `update: { percent: input.percent, archivedAt: null }`. Re-adding a previously archived `years` value reactivates the SAME row (verified in test (c) by asserting the returned `id` is unchanged and `findMany` for that `(facilityId, years)` still returns exactly 1 row). Code comment in `finance.ts` states explicitly that archive is not row-level history — the real audit trail is `receipt.tierPercent` (frozen at receipt time) + the audit log.

`discountTierList` returns `{ tiers, usingDefaults }` where `usingDefaults = tiers.length === 0`, matching `tiersFor`'s all-or-nothing fallback (confirmed via test: once ANY row exists for a facility, `tiersFor` stops falling back to `DEFAULT_DISCOUNT_TIERS` for any year, including unconfigured ones — this is pre-existing `finance.ts` behavior, not something this phase changed, and the test suite works around it by ordering tests so only one test observes the true 0-row state).

## Tests Status
- Type check: pass (`pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/admin typecheck` — both clean)
- Unit/integration tests: pass — `apps/api/test/discount-tier-config.int.test.ts` (4/4), `apps/api/test/permission-parity.test.ts` (26/26, updated snapshot)
- Coverage of the 5 acceptance criteria:
  - (a) 0-row facility → `usingDefaults: true`; upsert flips it to `false` — covered, test 1
  - (b) percent > 35 rejected server-side — covered, test 2 (zod `.max(DISCOUNT_CAP_PERCENT)`)
  - (c) archive-then-readd same `years` clears `archivedAt` + overwrites `percent` on the SAME row (asserted by `id`, and `findMany` count stays 1) — covered, test 3
  - (d) subsequent `receiptCreate` actually reprices via the real flow — covered, test 1 (combined with (a); real `caller.finance.receiptCreate`, not a mocked pricing call)
  - (e) cross-facility RLS on list/upsert/archive — covered, test 4
- All run against the real dev Postgres (port 5433), no mocks.

## Issues Encountered
- **Test ordering constraint (self-resolved, not a router bug):** `tiersFor()` in `finance.ts` is all-or-nothing per facility (rows.length ? rows : DEFAULT), not a per-year merge with defaults. This meant "0 rows → defaults" can only be observed once per facility per test run, so I combined criteria (a) and (d) into a single test and gave every other test a disjoint `years` value to avoid corrupting that invariant. Documented in a comment at the top of the test file. This is existing `finance.ts` behavior (pre-dates this phase) — did not touch `tiersFor` since it's outside this phase's file-ownership and other routers/phases depend on it as-is.
- **Cross-file concurrent edits:** `finance.ts` and `permissions.ts` were being edited concurrently by Phase 1/2/3 agents (saw `sendReceiptEmail`, `revenueReport`, `reconcileWorklist` land mid-session). No conflicts — additions were purely additive and my insertion points (after `voucherList`/`voucherCreate` block) didn't collide with theirs.
- **Test cleanup FK + leftover-state gotcha:** `receiptCreate` triggers `emitStaffNotif`, which can insert `staff_notification` rows referencing test fixture users; added an explicit `staffNotification.deleteMany` before `appUser.deleteMany` in `afterAll`. Also added a defensive `discountTier.deleteMany` at the START of `beforeAll` — `withRls`'s `afterAll` cleanup is one atomic transaction, so an earlier FK failure there (before the fix above) rolled back everything including the discountTier cleanup, leaving stale rows that broke the next run's "0 rows" assumption. Confirmed idempotent by running the suite twice in a row after the fix.

## Next Steps
- P5 (validation) can proceed once P1–P4 are all landed — this phase's file-ownership section is now released back for P5's cross-phase int+e2e pass.
- Not committed per instructions — orchestrator to review and commit.

Status: DONE
Summary: Discount-tier CRUD (list/upsert/archive) added to finance router + permissions + admin UI, capped at DISCOUNT_CAP_PERCENT server-side, upsert correctly reactivates archived rows in place, and a 4-test integration suite proves all 5 acceptance criteria including real repricing and cross-facility RLS against the live dev DB.
Concerns/Blockers: none — the `tiersFor` all-or-nothing-fallback behavior noted above is pre-existing and out of this phase's scope; flagging for awareness only in case P5's validation pass wants to revisit it as a future enhancement (per-year defaults merge instead of all-or-nothing).
