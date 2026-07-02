# Code Review: Refund Ledger (Phase 1, finance-ops)

Scope: `packages/db/prisma/schema.prisma` (RefundRecord), migrations
`20260702124908_refund_record` + `20260702124910_refund_record_rls`,
`apps/api/src/routers/finance.ts` (refundCreate/refundList),
`packages/auth/src/permissions.ts` (2 new lines), `apps/admin/src/finance-panel.tsx`,
`apps/api/test/refund-ledger-atomic-cap.int.test.ts`, `docs/decisions/0028-refund-ledger.md`.

## Overall Assessment

This is a well-executed, correctly-reasoned implementation. The core claim in the
implementer's report — that the plan's literal guarded-`INSERT...WHERE` example is not
actually atomic under READ COMMITTED, and that `SELECT ... FOR UPDATE` on the receipt row is
required instead — **is correct and I verified it independently**. A brand-new `INSERT` has no
pre-existing row for a `WHERE`-subquery `SUM()` to lock against; two concurrent `INSERT`
statements would both evaluate the subquery against the same pre-insert committed snapshot and
could both pass. Locking the parent `receipt` row via `FOR UPDATE` and re-reading the sum inside
the same transaction after acquiring the lock is genuinely atomic — the second transaction
physically blocks on the lock until the first commits or rolls back, then sees the first's
committed insert in its fresh READ COMMITTED statement snapshot. This is not an audit rubber
stamp — I traced `withRls` (`packages/db/src/index.ts:42-66`) and confirmed it uses one real
`prisma.$transaction` per call (not per-statement autocommit), so the lock is held for the
correct scope, and confirmed two concurrent `refundCreate` tRPC calls from `Promise.allSettled`
in the test really do open two separate transactions/connections (not serialized by a shared
caller object).

I independently re-ran the mandatory concurrency test and the full migration-drift check; both
pass. One real (non-blocking) defect found: the cancel-modal inline refund field is gated on a
narrower status than the plan/decision doc specifies (item g below).

## Verification Performed

1. **Atomicity re-derivation** (`finance.ts:1003-1057`): `SELECT id, facility_id, net_amount,
   status, approved_at FROM receipt WHERE id=$1 FOR UPDATE` locks the receipt row inside the
   `withRls` transaction; status/`approved_at` gate and the `SUM(refund_record.amount) + amount
   <= net_amount` cap are both evaluated *after* acquiring the lock, in the same critical
   section, before the `INSERT`. Matches plan requirement (c) — gate and cap share one atomic
   op, not a separate earlier check.

2. **Test run** — `cd apps/api && npx vitest run --config vitest.integration.config.ts
   test/refund-ledger-atomic-cap.int.test.ts` → **6/6 pass**, 724ms, against real dev DB
   (port 5433), no mocks.
   - Test #4 (`refund-ledger-atomic-cap.int.test.ts:147-169`) fires two `refundCreate` calls
     via `Promise.allSettled([...])` (not sequential `await`), each for 70% of `netAmount`.
     This is genuinely concurrent: `Promise.allSettled` schedules both promises before either
     resolves, and each `refundCreate` call independently opens its own `prisma.$transaction`
     (separate pooled connection), so the two `FOR UPDATE` locks race for real. Confirmed
     exactly 1 fulfilled / 1 `CONFLICT`, and `sum(refund_record.amount) <= netAmount` in DB
     afterward.

3. **`recordedById` server-derivation** (`finance.ts:1005-1010`, 1046): input schema is
   `{ receiptId, amount, reason }` only — no `recordedById` field accepted from the client.
   Server sets `recordedById: ctx.session.userId` unconditionally. Cannot be spoofed.

4. **Append-only guarantee**: `git diff -- apps/api/src/routers/finance.ts` shows only
   `refundCreate` (mutation, INSERT-only) and `refundList` (query). No update/delete procedure
   added anywhere in this diff.

5. **RLS policy + test**: migration `20260702124910_refund_record_rls/migration.sql` enables
   RLS and creates `refund_record_isolation` using the same
   `app_is_super_admin() OR (staff AND facility_id = ANY(app_facility_ids()))` pattern as
   `receipt`. Test #6 (`refund-ledger-atomic-cap.int.test.ts:197-223`) inserts a real row via a
   `SUPER` bypass context, then reads it with a facility-B-scoped `withRls` context (expects 0
   rows) and a facility-A-scoped context (expects >0 rows). This is a real cross-facility
   negative assertion, not a vacuous "table exists" check.

6. **Migration drift** — ran myself: `npx prisma migrate diff --from-url
   postgresql://cmc_app:cmc_app@localhost:5433/cmc?schema=public --to-schema-datamodel
   prisma/schema.prisma --exit-code` → `No difference detected.` (exit 0). Confirms 0 drift
   independent of the implementer's report claim.

7. **Decision record 0028** — content matches the shipped code: atomicity mechanism, two-call
   design, append-only rationale, and alternatives-considered (naive read-then-check explicitly
   rejected) all match what's in `finance.ts`. No inflated or fabricated claims found.

## Findings

### High — cancel-modal inline refund field doesn't match plan's stated gate (item g)

`apps/admin/src/finance-panel.tsx:806` gates the inline refund amount field in the cancel modal
on `cancelTarget?.status === 'approved'` only:

```tsx
{cancelTarget?.status === 'approved' && (
  <NumberInput label="Hoàn tiền (tùy chọn, VNĐ)" ... />
)}
```

But `receiptCancel` accepts receipts in `approved`, `sent`, or `reconciled` status (see
`finance.ts:860-863`, `wasApproved = status IN (approved, sent, reconciled)`), and the plan
explicitly says the field should show "only for approved/sent/reconciled receipts"
(`phase-01-refund-ledger.md:22`). As written, a receipt that is currently `sent` or
`reconciled` when the user opens the cancel modal will **not** show the inline refund field —
staff must cancel first, then use the separate standalone "Ghi hoàn tiền" button (which
correctly checks `r.status === 'cancelled' && r.approvedAt`, `finance-panel.tsx:755-765`) to
record the refund in a second step.

Impact: not a security or data-integrity bug (the standalone path is correct and the server
guard is authoritative), but it silently degrades the one-step cancel+refund UX for the
`sent`/`reconciled` cases the plan called out, and a rushed staff member cancelling a `sent`
receipt gets no visual prompt to also record a refund — they'd have to remember to click
"Ghi hoàn tiền" separately.

Fix: change the condition to
`cancelTarget && ['approved', 'sent', 'reconciled'].includes(cancelTarget.status)`.

### Informational — permissions.ts diff includes unrelated concurrent-phase noise

`git diff -- packages/auth/src/permissions.ts` currently shows 8 added lines, but only 2
(`refundCreate`, `refundList`) belong to this phase. The other 6
(`enrollment.transfer`, `parentMeeting.setNote`, `classSchedule.createMakeupSession`) are
uncommitted working-tree changes from a different concurrent phase, as the task brief already
flagged. Not a defect in this phase's diff — noting only so it isn't mistaken for scope creep
in this specific review. No action needed here; will resolve itself when phases commit
separately.

### Informational — CONFLICT error message includes VND amounts

`finance.ts:1043` returns `Vượt số tiền phiếu: đã hoàn X đ / Y đ` to the client. Both values
are non-sensitive receipt-scoped financial totals, and the procedure is already
permission-gated to `ke_toan`/`giam_doc_kinh_doanh` who have legitimate access to this same
data via `refundList`/receipt detail. Not a data-exposure issue; documented for completeness
per the threat-model check, no fix needed.

## Items Explicitly Verified Per Review Brief

- (a) `recordedById` server-derived, never client input — **confirmed**.
- (b) Append-only, no update/delete added — **confirmed**.
- (c) Status/approvedAt gate folded into the same atomic critical section as the cap check —
  **confirmed**, both evaluated after the `FOR UPDATE` lock, before insert.
- (d) RLS blocks cross-facility reads, test is real — **confirmed**.
- (e) `prisma migrate diff` 0 drift — **confirmed independently**.
- (f) Decision 0028 content matches implementation — **confirmed**.
- (g) Refund field only for approved-then-cancelled receipts — **partially confirmed**: the
  server guard and the standalone "Ghi hoàn tiền" button are correct; the inline cancel-modal
  field is over-narrow (High finding above).

## Recommended Actions

1. Widen the cancel-modal refund-field condition in `finance-panel.tsx` to include
   `sent`/`reconciled`, matching the plan and the standalone button's own gate logic.
2. No other blocking changes required. The atomicity design, RLS, permission scoping, and
   append-only guarantee are all sound and test-verified.

## Unresolved Questions

None.
