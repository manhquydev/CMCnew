# Phase 1 — Refund Ledger (manual money-out record)

## Context links
- Report §PLAN 4.1 + D-P4a (manual amount; pro-rata = DEBT).
- Cancel flow: `apps/api/src/routers/finance.ts:737-844` (`receiptCancel` — status flip + voucher/enrollment rollback, NO money-out).
- Panel: `apps/admin/src/finance-panel.tsx:419-497` (cancel state/`doCancel`), modal `:626-642`.
- Perms: `packages/auth/src/permissions.ts:125-136` (`finance.*`).
- Schema: `packages/db/prisma/schema.prisma` (Receipt model; DiscountTier@983 as a model-shape reference).

## Overview
Add an append-only `RefundRecord` (money-out ledger) captured at the moment of cancel. GĐ/kế toán enters the refund amount (D-P4a: manual, no auto pro-rata) + reason + payer. Refund never mutates `receipt.netAmount` (audit-preserving). One receipt may accrue multiple refunds (partial) → sum ≤ receipt.netAmount guard.

## Key Insights
- `receiptCancel` already runs inside `withRls` + `logEvent`; add the refund write in the SAME txn so cancel+refund are atomic.
- Refund is OPTIONAL on cancel (draft/never-approved receipt = no money moved → no refund row). Only offer refund entry when `wasApproved` (mirrors `finance.ts:747`).
- Append-only: no update/delete endpoint. Correction = a compensating negative-amount row (documented in decision 0028), keeps audit trail intact.

## Requirements
- Model `RefundRecord { id, receiptId FK, facilityId, amount Int, reason String, paidById FK→AppUser, createdAt }` + `@@index([receiptId])`, `@@index([facilityId])`. RLS-scoped by facilityId (follow existing receipt RLS pattern).
- New perms `finance.refundCreate`, `finance.refundList` → `['ke_toan','giam_doc_kinh_doanh']`.
- Mutation `finance.refundCreate({ receiptId, amount, reason })`: validate receipt is cancelled OR being cancelled; `amount > 0`; `sum(existing refunds)+amount ≤ receipt.netAmount`; `paidById = ctx.session.userId`; `logEvent` money-out. Query `finance.refundList({ receiptId })`.
- Extend cancel modal: after reason, an optional "Hoàn tiền" amount field (prefill blank, NOT auto pro-rata) shown only for approved/sent/reconciled receipts. On confirm, call `receiptCancel` then `refundCreate` (sequential; refund failure must not silently swallow — surface error, cancel already committed → refund can be added later from receipt row).
- Show refund total on the receipt row / detail.

## Architecture
Data flow: cancel modal → `receiptCancel` (txn A: status+rollback) → `refundCreate` (txn B: append RefundRecord + audit). Two txns (not one) because cancel already returns before refund UI resolves; refundCreate independently guarded so a later standalone refund is possible. Alternative single-txn (pass optional refund into receiptCancel) is cleaner but widens the cancel contract — chosen two-call to keep `receiptCancel` signature stable for existing callers.

## Related code files
- MODIFY `packages/db/prisma/schema.prisma` (add RefundRecord + Receipt back-relation).
- CREATE migration `packages/db/prisma/migrations/<ts>_refund_record/migration.sql`.
- MODIFY `apps/api/src/routers/finance.ts` (refundCreate/refundList; optionally read refunds in receiptList).
- MODIFY `packages/auth/src/permissions.ts` (2 new perms).
- MODIFY `apps/admin/src/finance-panel.tsx` (refund field in cancel modal + refund total display).

## Implementation Steps
1. Add RefundRecord model + Receipt `refunds RefundRecord[]` back-relation.
2. Generate migration; verify RLS policy present on new table (match receipt policy) so cross-facility read is blocked.
3. Add perms + `refundCreate`/`refundList` in finance router with sum-cap guard + audit.
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
- Refund sum cannot exceed receipt.netAmount (rejected with clear message).
- Cross-facility user cannot read another facility's refunds (RLS verified).
- `prisma migrate diff` clean after apply.

## Risk Assessment
- **Data model / money (High×High)**: mitigate with sum-cap guard, append-only design, audit on every write, RLS policy parity test.
- **Partial-failure (Med)**: cancel commits then refund fails → mitigate by making refund addable standalone on the cancelled row (no orphaned state; user retries).
- **RLS gap (Med×High)**: new table without policy = leak → explicit policy step + test before merge.

## Security Considerations
- `paidById` server-derived from session, never client input.
- Amount is Int VND; reject negative on create (compensating entries are an operator-documented exception, not a UI path in this phase).
- No PII beyond payer userId.

## Rollback (DB phase)
- Forward-only migration adds one table + one FK; safe to `DROP TABLE refund_record` + revert Receipt relation if reverted before any refund row exists. If rows exist, export first (money records — never hard-drop without backup). Revert router/UI edits independently (no data impact).

## Next steps
P2 (email ops) — independent of refund data; may start once P1 merged and finance-panel.tsx is free.
