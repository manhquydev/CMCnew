# Phase 1 — Refund Ledger: completion report

Plan: `plans/260702-1109-finance-ops/phase-01-refund-ledger.md`
Decision record: `docs/decisions/0028-refund-ledger.md`

## Files modified

- `packages/db/prisma/schema.prisma` — `RefundRecord` model + `Receipt.refunds` back-relation.
- `packages/db/prisma/migrations/20260702124908_refund_record/migration.sql` — new table (real `prisma migrate dev`, applied to dev DB port 5433).
- `packages/db/prisma/migrations/20260702124910_refund_record_rls/migration.sql` — RLS policy (matches `receipt`/`shift_*` facility-isolation pattern).
- `apps/api/src/routers/finance.ts` — `refundCreate` + `refundList` procedures only; no existing procedure touched.
- `packages/auth/src/permissions.ts` — 2 new entries (`finance.refundCreate`, `finance.refundList`, same role scope as `receiptCancel`).
- `apps/api/test/fixtures/permission-snapshot.json` — 2 new snapshot rows to match.
- `apps/admin/src/finance-panel.tsx` — refund amount field in the cancel modal (approved-only), standalone "Ghi hoàn tiền" action on cancelled+approved rows, "Đã hoàn" column with lazy per-row total fetch.
- `apps/api/test/refund-ledger-atomic-cap.int.test.ts` — new, 6 tests (see below).
- `docs/decisions/0028-refund-ledger.md` — new decision record.

## Architecture decision: FOR UPDATE, not the guarded-INSERT literal example

The plan offered two options. I implemented **option 2 (row lock)**, not the literal guarded-`INSERT...SELECT...WHERE` SQL shown in the plan's option 1. Reasoning: that literal INSERT-with-subquery-WHERE is **not actually atomic** under Postgres READ COMMITTED — a plain `SELECT SUM(...)` inside an INSERT's WHERE clause takes no lock, so two concurrent statements can both read the same pre-insert sum and both pass. The voucher-consume precedent it's modeled on (`finance.ts:359-369`) is safe only because it's an `UPDATE` on the *same* row, which Postgres does row-lock. A brand-new `INSERT` has no analogous row to lock unless you take one explicitly.

Implementation: `SELECT id, facility_id, net_amount, status, approved_at FROM "receipt" WHERE id=$1 FOR UPDATE` inside the `withRls` txn, locks the receipt row so a second concurrent `refundCreate` call blocks until the first commits, then its `SUM(amount)` re-read correctly includes the first call's insert. This is genuinely atomic and is what the mandatory concurrency test proves.

## Tests (all run against real dev DB, no mocks)

`apps/api/test/refund-ledger-atomic-cap.int.test.ts` — 6/6 pass:
1. Refund on approved-then-cancelled receipt succeeds + audit `recordEvent` written; `receipt.netAmount` unchanged.
2. Refund on draft-cancelled (never approved) receipt → `BAD_REQUEST`, 0 rows written.
3. Refund on still-approved (not cancelled) receipt → `BAD_REQUEST`.
4. **Mandatory**: two concurrent `refundCreate` calls (70%+70% of netAmount) → exactly 1 fulfilled, 1 `CONFLICT`, `sum(refund_record.amount) <= netAmount`.
5. Sequential: 60% accepted, next 60% rejected (`CONFLICT`), exact remainder (40%) accepted → total == netAmount.
6. Cross-facility RLS: facility-B scope reads 0 rows for a facility-A receipt's refunds; facility-A scope reads them.

Also reran and confirmed green: `rls-coverage.int.test.ts` (self-proving schema introspection now reports `refund_record: RLS enabled, 1 policy(ies) refund_record_isolation`, 51/51 tables covered), `voucher-atomic.int.test.ts`, `permission-parity.test.ts` (26/26 after snapshot update), `rls-tenancy.int.test.ts`, `receipt-kind-classification.int.test.ts`, `student-provisioning-approve.int.test.ts` — 50/50 total across the combined run.

`pnpm --filter @cmc/api typecheck` and `pnpm --filter @cmc/admin typecheck`: both clean.

`prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --exit-code`: **no difference detected** (0 drift) after applying both migrations.

## Note on a transient unrelated test failure

Mid-session, `permission-parity.test.ts` briefly failed on `parentMeeting.setNote` (a module I never touched) — this was a race with a concurrent teammate actively editing the same shared `permissions.ts`/snapshot files for a different phase. Rerunning immediately after showed it green; not caused by this phase's diff (confirmed via `git diff --stat` scoped to just the finance additions).

## Deviations from the plan text

- Row-lock (option 2) implemented instead of the literal guarded-INSERT SQL in option 1, for the correctness reason above — this is explicitly one of the two "acceptable mechanisms" the plan allows.
- `recordedById` has no enforced DB foreign key to `app_user` — this matches the existing house convention on `Receipt` (`collectedById`/`approvedById`/`soldById` are all plain UUID columns without FK constraints; see `20260623170152_phase3_revenue_s1/migration.sql`), not a corner cut specific to this phase.

## Unresolved questions

None — all plan requirements, todo items, and success criteria are met.

Status: DONE
Summary: RefundRecord ledger shipped with atomic (row-lock, not naive read-then-check) sum-cap concurrency, RLS-verified, decision 0028 recorded, 6 new integration tests + updated permission snapshot all green, 0 migration drift, both packages typecheck clean.
Concerns/Blockers: none.
