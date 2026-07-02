# Phase 1 — Refund Ledger (manual money-out record)

## Context links
- Report §PLAN 4.1 + D-P4a (manual amount; pro-rata = DEBT).
- Cancel flow: `apps/api/src/routers/finance.ts:737-844` (`receiptCancel` — status flip + voucher/enrollment rollback, NO money-out).
- Panel: `apps/admin/src/finance-panel.tsx:419-497` (cancel state/`doCancel`), modal `:626-642`.
- Perms: `packages/auth/src/permissions.ts:125-136` (`finance.*`).
- Schema: `packages/db/prisma/schema.prisma` (Receipt model; DiscountTier@983 as a model-shape reference).

## Overview
Add an append-only `RefundRecord` (money-out ledger) captured at the moment of cancel. GĐ/kế toán enters the refund amount (D-P4a: manual, no auto pro-rata) + reason + payer. Refund never mutates `receipt.netAmount` (audit-preserving). One receipt may accrue multiple refunds (partial) → sum ≤ receipt.netAmount guard, enforced atomically (see Architecture — no read-then-write race).

## Key Insights
- `receiptCancel` already runs inside `withRls` + `logEvent`; refund is a SEPARATE guarded mutation (two-txn design, see Architecture) — cancel commits first, refund follows or is added standalone later.
- Refund only on a receipt that actually took money in: guard requires `status = 'cancelled' AND approvedAt IS NOT NULL`. A draft receipt cancelled before approval never had money in (`receiptCancel` accepts drafts — `finance.ts:742-747` only rejects already-cancelled), so it gets NO refund row. UI offers the field only for approved-then-cancelled receipts, but the guard is the trust boundary, not the modal.
- Append-only: no update/delete endpoint. Correction of an over/under-refund = an ADDITIONAL refund row up to the remaining cap; a fat-finger over-refund is fixed via a documented DBA/ops SQL path (out of scope here, stated in decision 0028). No negative-amount "compensating entry" — amounts are strictly non-negative and cap-bounded, so a negative correction would be unimplementable.

## Requirements
- Model `RefundRecord { id, receiptId FK, facilityId, amount Int, reason String, recordedById FK→AppUser, createdAt }` + `@@index([receiptId])`, `@@index([facilityId])`. RLS-scoped by facilityId (follow existing receipt RLS pattern). `recordedById` = the staff who entered the refund (session user), NOT the money recipient — the recipient is derivable via receipt→student→guardian; document that, do not store it in v1.
- New perms `finance.refundCreate`, `finance.refundList` → `['ke_toan','giam_doc_kinh_doanh']`.
- Mutation `finance.refundCreate({ receiptId, amount, reason })`: guard `receipt.status = 'cancelled' AND approvedAt IS NOT NULL`; `amount >= 1` (strictly non-negative VND); atomic sum-cap (see Architecture — locked, not read-then-check); `recordedById = ctx.session.userId`; `logEvent` money-out. Query `finance.refundList({ receiptId })`.
- Extend cancel modal: after reason, an optional "Hoàn tiền" amount field (prefill blank, NOT auto pro-rata) shown only for approved/sent/reconciled receipts. On confirm, call `receiptCancel` then `refundCreate` (sequential; refund failure must not silently swallow — surface error, cancel already committed → refund can be added later from receipt row).
- Show refund total on the receipt row / detail.

## Architecture
Data flow: cancel modal → `receiptCancel` (txn A: status+rollback) → `refundCreate` (txn B: append RefundRecord + audit). Two txns (not one) because cancel already returns before refund UI resolves; refundCreate independently guarded so a later standalone refund is possible. Alternative single-txn (pass optional refund into receiptCancel) is cleaner but widens the cancel contract — chosen two-call to keep `receiptCancel` signature stable for existing callers.

**Sum-cap concurrency (C1 — atomic claim, NOT read-then-write).** Two concurrent `refundCreate` calls under READ COMMITTED would both read the same `SUM(amount)` and both pass a naive check → money-out overshoot. Mirror the existing atomic-claim pattern in this router (voucher consume `finance.ts:322-332`; draft claim `:343-349` — a single guarded write that checks-and-mutates atomically). Two acceptable mechanisms, pick one at build:
  1. **Guarded conditional insert** — one statement whose `WHERE` re-evaluates the cap against committed rows, e.g.
     `INSERT INTO "refund_record" (receipt_id, facility_id, amount, reason, recorded_by_id) SELECT $receiptId, $facilityId, $amount, $reason, $userId WHERE $amount >= 1 AND (SELECT COALESCE(SUM(amount),0) FROM "refund_record" WHERE receipt_id=$receiptId) + $amount <= (SELECT net_amount FROM "receipt" WHERE id=$receiptId AND status='cancelled' AND approved_at IS NOT NULL);`
     then assert `rowCount === 1`; `0` → reject "vượt số tiền phiếu / phiếu chưa duyệt". The status+approvedAt gate is folded into the same WHERE so it cannot be bypassed.
  2. **Row lock** — `SELECT net_amount, status, approved_at FROM "receipt" WHERE id=$1 FOR UPDATE` inside the txn, validate gate + sum, then insert. Serializes concurrent refunds on the receipt row.
Both run inside the `withRls` txn so a throw rolls back cleanly. An int test MUST fire two concurrent `refundCreate` calls summing over `netAmount` and assert exactly one succeeds.

## Related code files
- MODIFY `packages/db/prisma/schema.prisma` (add RefundRecord + Receipt back-relation).
- CREATE migration `packages/db/prisma/migrations/<ts>_refund_record/migration.sql`.
- MODIFY `apps/api/src/routers/finance.ts` (refundCreate/refundList; optionally read refunds in receiptList).
- MODIFY `packages/auth/src/permissions.ts` (2 new perms).
- MODIFY `apps/admin/src/finance-panel.tsx` (refund field in cancel modal + refund total display).

## Implementation Steps
1. Add RefundRecord model + Receipt `refunds RefundRecord[]` back-relation.
2. Generate migration; verify RLS policy present on new table (match receipt policy) so cross-facility read is blocked.
3. Add perms + `refundCreate`/`refundList` in finance router with the ATOMIC sum-cap + status/`approvedAt` gate (see Architecture) + audit.
4. Wire cancel modal amount field (approved-only) + post-cancel refundCreate call; add standalone "Ghi hoàn tiền" action on cancelled rows.
5. Display refund total.

## Todo list
- [ ] schema + migration (0-drift)
- [ ] RLS policy on refund_record
- [ ] perms + router mutation/query + cap guard
- [ ] cancel modal + standalone refund UI
- [ ] refund total display

## Success Criteria
- Cancelling an approved receipt with an entered amount creates a RefundRecord + audit event; receipt.netAmount unchanged.
- Refund sum cannot exceed receipt.netAmount, enforced under concurrency (two concurrent refunds summing over netAmount → exactly one succeeds).
- `refundCreate` on a cancelled-but-never-approved (draft-cancelled) receipt is rejected.
- Cross-facility user cannot read another facility's refunds (RLS verified).
- `prisma migrate diff` clean after apply.

## Risk Assessment
- **Sum-cap race (High×High)**: concurrent refunds overshoot netAmount → mitigate with the ATOMIC claim (guarded insert or `FOR UPDATE`, Architecture) + a two-concurrent-refund int test. A read-then-check guard is NOT acceptable.
- **Refund on never-approved receipt (High×High)**: draft cancelled → money-out with no money-in → mitigate with the `status='cancelled' AND approvedAt IS NOT NULL` gate folded into the same guarded write.
- **Data model / money (High×High)**: mitigate with append-only design, audit on every write, RLS policy parity test.
- **Partial-failure (Med)**: cancel commits then refund fails → mitigate by making refund addable standalone on the cancelled row (no orphaned state; user retries).
- **RLS gap (Med×High)**: new table without policy = leak → explicit policy step + test before merge.

## Security Considerations
- `recordedById` server-derived from session, never client input.
- Amount is Int VND, `>= 1`; negatives are rejected outright. There is NO compensating-negative path (would be unimplementable against the non-negative cap guard). Over-refund correction is a documented DBA/ops SQL procedure (decision 0028), out of scope here.
- Refund only against a receipt that was actually approved (`approvedAt IS NOT NULL`) then cancelled — the guard blocks recording money-out on a never-funded draft.
- No PII beyond `recordedById` userId.

## Rollback (DB phase)
- Forward-only migration adds one table + one FK; safe to `DROP TABLE refund_record` + revert Receipt relation if reverted before any refund row exists. If rows exist, export first (money records — never hard-drop without backup). Revert router/UI edits independently (no data impact).

## Next steps
P2 (email ops) — independent of refund data; may start once P1 merged and finance-panel.tsx is free.
