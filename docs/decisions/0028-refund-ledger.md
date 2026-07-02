# Refund ledger (append-only money-out)

Date: 2026-07-02

## Status

Accepted

## Context

Cancelling a receipt (`finance.receiptCancel`, `finance.ts:850-994`) flips status, rolls back
voucher use and enrollment/student provisioning — but records no money-out. When a facility
actually refunds a family, there is nowhere to record it: `receipt.netAmount` is a frozen
money-in figure and must never be mutated after approve (it feeds commission and audit
history). Staff need a way to enter a manual refund amount (report §PLAN 4.1, D-P4a: manual
amount, no auto pro-rata) tied to the cancelled receipt, without touching the original figure.

## Decision

1. **New append-only `RefundRecord` model** — `{ id, receiptId, facilityId, amount, reason,
   recordedById, createdAt }`, RLS-scoped by `facilityId` (same policy pattern as `receipt`).
   `recordedById` is the staff member who entered the refund (server-derived from session),
   not the money recipient — the recipient is derivable via `receipt → student → guardian` and
   is not duplicated here in v1.

2. **`finance.refundCreate`/`finance.refundList`** (`ke_toan`, `giam_doc_kinh_doanh`, same scope
   as `receiptCancel`). The guard — `receipt.status = 'cancelled' AND approvedAt IS NOT NULL`,
   plus the running-sum cap `SUM(amount) + newAmount <= receipt.netAmount` — is evaluated
   **atomically** inside one critical section: `SELECT ... FOR UPDATE` locks the receipt row for
   the duration of the transaction, so two concurrent `refundCreate` calls on the same receipt
   serialize on that lock; the second call's re-read of `SUM(amount)` sees the first call's
   already-committed insert. This is not a read-then-check race — the row lock is what makes it
   atomic. Verified by an integration test that fires two concurrent calls summing over
   `netAmount` and asserts exactly one succeeds.

3. **`receiptCancel` and `refundCreate` are two separate calls, not one transaction.** The cancel
   modal calls `receiptCancel` first, then optionally `refundCreate`. If the refund call fails
   after cancel already committed, the UI surfaces the error and offers a standalone "Ghi hoàn
   tiền" action on the now-cancelled row so the refund can be added without re-cancelling.

4. **Append-only, no update/delete endpoint.** A correction (under- or over-refund) is an
   additional refund row up to the remaining cap. A fat-finger over-refund is corrected via a
   documented DBA/ops SQL procedure, out of scope for this phase — there is no
   compensating-negative-amount path, since amounts are strictly `>= 1` and cap-bounded, making
   a negative correction unimplementable against the same guard.

## Alternatives Considered

1. **Single txn**: fold an optional refund amount directly into `receiptCancel`'s input.
   Rejected — widens the `receiptCancel` contract for every existing caller and couples two
   independently-useful operations (a receipt can be cancelled without ever being refunded, and
   a refund can be added well after cancel, e.g. once a bank transfer clears).
2. **Naive read-then-check sum guard** (read `SUM(amount)`, compare in application code, then
   insert). Rejected outright — under concurrent load two calls can both read the same
   pre-insert sum and both pass, overshooting `netAmount`. This is exactly the failure mode the
   atomic `FOR UPDATE` design prevents.
3. **Negative compensating-entry rows** for over-refund correction. Rejected — conflicts with
   the non-negative, cap-bounded amount invariant; would require reintroducing a read-then-check
   window to validate a negative delta against the cap, defeating the atomicity design.

## Consequences

Positive:

- Money-out is now auditable per receipt without ever mutating the frozen `netAmount`.
- The sum-cap is provably atomic under concurrency (integration-tested), not a best-effort
  application-level check.
- Refund entry is decoupled from the cancel action, so a delayed or partial refund doesn't block
  or reopen the cancel flow.

Tradeoffs:

- Two-call design means a refund can be "missing" immediately after cancel if the second call
  fails; mitigated by the standalone retry action on the cancelled row (no orphaned money state,
  just a manual retry).
- Over-refund correction has no in-app path — it is an explicit DBA/ops SQL procedure. Accepted
  because building a safe compensating-entry UI is out of scope for a v1 append-only ledger.

## Follow-Up

- Integration tests (`apps/api/test/refund-ledger-atomic-cap.int.test.ts`): approved-then-cancelled
  refund succeeds + audit event; draft-cancelled (never-approved) refund rejected; still-approved
  (not cancelled) refund rejected; two-concurrent-refunds-over-cap → exactly one succeeds;
  under-cap-then-remainder accepted; cross-facility RLS denial.
- `permission-snapshot.json` updated with `finance.refundCreate` / `finance.refundList`.
