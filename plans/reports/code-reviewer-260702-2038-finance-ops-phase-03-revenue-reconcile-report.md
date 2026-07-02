# Code Review — Finance-Ops Phase 3 (Revenue Report + Reconciliation Worklist)

Scope reviewed: `apps/api/src/routers/finance.ts` (`revenueReport`, `revenueReportCsv`,
`reconcileWorklist`, `csvText`), `packages/auth/src/permissions.ts` (finance.revenueReport /
finance.reconcileWorklist), `apps/admin/src/revenue-report.tsx`, `apps/admin/src/reconcile-worklist.tsx`,
nav wiring, and the two new test files. Phase 2/4 content (email outbox, discount tiers) intentionally
excluded per instructions.

## Verification performed
- Read `packages/db/prisma/schema.prisma`: confirmed `Receipt.approvedAt` exists (line 1053),
  `issuedAt` exists only on `Certificate` (line 1327) — not on `Receipt`. Period-key claim (a) holds.
- Read `packages/db/src/index.ts` `withRls`: uses `prisma.$transaction`, sets RLS GUCs via
  `set_config(..., true)` (transaction-local) on the same `tx` handle passed to `$queryRaw`. Since
  Prisma's interactive transaction holds one dedicated connection, the GUCs are visible to raw SQL
  issued on that same `tx` — claim (f) holds for `$queryRaw`. Confirmed `refund_record` and
  `facility` both have `ENABLE ROW LEVEL SECURITY` + a facility-scoped policy
  (`refund_record_rls` migration, `rls_tenancy` migration).
- Ran `npx vitest run --config vitest.integration.config.ts test/revenue-report-reconcile-worklist.int.test.ts` — 6/6 pass.
- Ran `npx vitest run test/finance-csv-formula-guard.unit.test.ts` (default config, NOT the
  integration config) — 7/7 pass. **Note**: the review-provided command
  (`--config vitest.integration.config.ts ... finance-csv-formula-guard.unit.test.ts`) matches 0
  files, because `vitest.integration.config.ts`'s `include` is `test/**/*.int.test.ts` and this
  file is named `*.unit.test.ts`. Re-run without `--config` (uses `vitest.config.ts`, which has no
  include restriction) to actually execute it.
- `pnpm --filter @cmc/api typecheck` — clean. `pnpm --filter @cmc/admin typecheck` — clean.
- Grepped `course.create` / `facility.create` / `facility.update` permission grants and input
  schemas to verify the report's CSV-injection "unreachable" claim (see Critical Issue below).

## Critical Issues
None. No money-mutation path added, no RLS bypass found, no auth gap found.

## High Priority

**1. Implementer's report factually misstates why the CSV formula-injection guard is "unreachable" — course/facility codes are NOT system-assigned, they are free-text staff input.**
`apps/api/src/routers/finance.ts` (labelMap construction in `computeRevenueBuckets`, ~lines 155–195)
builds labels as `` `${code} — ${name}` ``, code first. The report claims this makes the guard dead
code because codes are "system-assigned." That is false:
- `apps/api/src/routers/course.ts:32` — `code: z.string().min(1)` — course code is arbitrary
  operator-entered text, no character restriction, gated only by `course.create` = `['giam_doc_dao_tao']`
  (`packages/auth/src/permissions.ts:44`), a facility-level staff role, not `super_admin`.
- `apps/admin/src/courses-panel.tsx:43` — client-side validation is `required + minLength(2)`,
  no character allow-list either.
- `apps/api/src/routers/facility.ts:48` — `code: z.string().min(1)`, gated by `super_admin` — also
  unrestricted, just a higher-trust actor.
- A `giam_doc_dao_tao` account (compromised, or simply a typo/prank) creating a course with
  `code = "=cmd|'/c calc'!A1"` produces a course-grouped CSV row whose **label itself** starts with
  `=`, landing exactly at cell position 0 — the scenario the report calls impossible.

The actual behavior is still safe **only because** `csvText` (finance.ts) is applied to the whole
`label` string unconditionally, not conditionally on "is this a user-controlled name." So there is
no live vulnerability — but the report's reasoning for why the guard is "dead code / documented
non-issue" is wrong, and the test suite doesn't cover this specific case: the integration test
(`revenue-report-reconcile-worklist.int.test.ts:187-204`) only seeds a malicious **facility name**
(second position in the label), never a malicious **course code** (first position). If a future
change reorders the label (e.g. `${name} (${code})`) or someone reads this "unreachable" claim and
removes the guard as pure defense-in-depth cruft, the course-code path becomes a real formula
injection into Excel for any `ke_toan`/`giam_doc_kinh_doanh` user who exports a course-grouped CSV.
**Action**: correct the code comment/report claim (drop "system-assigned"/"unreachable" framing —
say instead "guard applies to the full label regardless of source, including operator-entered
codes"), and add a course-grouped CSV test case where `course.code` itself starts with `=`.

**2. Refund cross-month bucketing (spec requirement (b)) is asserted in code but not proven by any test.**
`revenue-report-reconcile-worklist.int.test.ts:145-167` ("net = gross − refunds...") sets
`r5.approvedAt = '2031-06-12'` and then overrides `refund.createdAt = '2031-06-15'` — both June. The
code correctly buckets refunds by `RefundRecord.createdAt` independently of `Receipt.approvedAt`
(finance.ts raw SQL, `refund_record` grouped by its own `created_at`), but because the test's refund
and receipt land in the *same* month, a regression that bucketed refunds by the receipt's
`approvedAt` instead would pass this test unchanged. This is a phantom-test gap on exactly the
requirement flagged as Risk "Refund-blind report (Med×High)" in the plan. **Action**: add a case
where a receipt is approved in month N and its refund is recorded (via `refundCreate`, then
`createdAt` overridden) in month N+2, and assert the refund appears in N+2's bucket, not N's.

## Medium Priority

**3. `reconcileWorklist` has no date-range cap and no pagination, unlike `revenueReport`.**
`revenueReportInput` enforces `to - from <= 1096 days` (finance.ts:~95). The
`reconcileWorklist` input schema (finance.ts, near the procedure definition) only enforces
`from < to`, with no upper bound and no `take`/limit on the `receipt.findMany`. A
`giam_doc_kinh_doanh` (multi-facility) caller requesting an unbounded period with no `facilityId`
filter can return every un-reconciled receipt across all their facilities in one unbounded query.
Low likelihood of abuse (only 2 trusted roles can call it) but inconsistent with the plan's own
Risk Assessment note ("unbounded period → cap the range or paginate, report the row count") and
with the cap already applied to the sibling endpoint. **Action**: apply the same 3-year (or
tighter) range cap used by `revenueReportInput`, or note explicitly why the worklist is exempt.

## Low Priority
- `revenue-report.tsx` / `reconcile-worklist.tsx` do client-side `from`/`to` as free-text
  `YYYY-MM-DD` inputs with no format guard before calling the query (server does validate via
  `regex(dateOnly)`, so this is UX-only, not a trust-boundary issue — user just gets a raw tRPC
  error string instead of an inline field error).
- `buildRevenueCsv`/`csvNumber` truncate with `Math.trunc` — fine since all inputs are already
  integer VND from Postgres `bigint` sums; no rounding-mode ambiguity in practice.

## Verified-correct (spec claims (a)–(g))
- (a) Period key = `Receipt.approvedAt`, confirmed against schema; `issuedAt` does not exist on
  `Receipt`. Correct.
- (b) `net = gross − refunds` computed correctly in code; refunds bucketed by
  `RefundRecord.createdAt`, not `approvedAt` — **correct in code, but see Finding 2 (untested
  cross-month case)**.
- (c) Course grouping uses `Receipt.courseId` direct FK (schema.prisma:1030-1031), no enrollment
  join, no double-count. Correct.
- (d) Retroactive-cancel is genuinely tested — `revenue-report-reconcile-worklist.int.test.ts:169-185`
  asserts gross before/after a `receiptCancel` call, not just prose. Correct.
- (e) `reconcileWorklist` is a `.query` (read-only); the UI's "Đối soát" button calls the existing
  `finance.receiptReconcile.mutate`. No new money-mutation path added. Correct.
- (f) RLS scoping: `$queryRaw` on the `withRls`-scoped `tx` genuinely inherits the transaction-local
  GUCs (same connection, same transaction) — confirmed via `withRls` implementation and the
  `facility_isolation`/`refund_record_isolation` RLS policies. The int test
  (`... RLS: a facility-B-scoped caller's report excludes facility-A figures`) exercises the
  `groupBy: 'facility'` path only, not `'course'` (which involves an extra JOIN in the refund
  query) — acceptable given RLS is table-level and applies uniformly, but worth noting as a gap if
  RLS policy correctness is ever in question again.
- (g) CSV: BOM (`﻿`) present at position 0, header `key,label,gross,refunds,net,count` in
  fixed order — confirmed by direct test assertion and code read. Correct.

## Auth / permissions
`finance.revenueReport` / `finance.reconcileWorklist` → `['ke_toan', 'giam_doc_kinh_doanh']`,
matching the spec's grantee set and mirrored correctly in
`apps/api/test/fixtures/permission-snapshot.json` and `apps/admin/src/nav-permissions.ts`.
`revenueReportCsv` reuses the `finance.revenueReport` permission key (no separate grant needed) —
consistent, gated identically. No escalation found.

## Tests / Typecheck
- `revenue-report-reconcile-worklist.int.test.ts`: 6/6 pass.
- `finance-csv-formula-guard.unit.test.ts`: 7/7 pass (must be run WITHOUT
  `--config vitest.integration.config.ts` — see Verification section above).
- `pnpm --filter @cmc/api typecheck`: pass.
- `pnpm --filter @cmc/admin typecheck`: pass.

## Recommended Actions (priority order)
1. Correct the "system-assigned code" / "unreachable" framing in `finance.ts` comments and the
   phase-03 completion report; add a course-code-starts-with-`=` CSV test case (High).
2. Add a cross-month refund-bucketing test case to close the phantom-test gap on requirement (b) (High).
3. Cap `reconcileWorklist`'s date range (or document the deliberate exemption) for consistency with
   `revenueReport` and the plan's own risk note (Medium).

## Unresolved Questions
- None blocking. Confirm with the user/orchestrator whether `reconcileWorklist`'s unbounded range
  is an accepted YAGNI trade-off (2 trusted roles only) or should get the same cap before merge.
