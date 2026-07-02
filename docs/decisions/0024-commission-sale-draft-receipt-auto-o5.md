# Commission sale draft-receipt + auto-O5 on approve

Date: 2026-07-02

## Status

Accepted

## Context

The commission money-chain is broken at the sale → finance hand-off. Sale closes an
opportunity at O4 (enrolled) but cannot create a receipt, so finance-panel creates
receipts without `opportunityId` — commission attribution has no link to the originating
opportunity. Even when `opportunityId` is passed server-side (the API already accepts it
at `finance.ts:198,258`), the two UI call sites in `finance-panel.tsx:714,727` never send
it. There is also no auto-advance: approving a receipt does not move the linked
opportunity to O5_ENROLLED, so "won" metrics and commission `kind` (new vs renewal) are
stale.

Sale currently has no `finance.receiptCreate` permission
(`permissions.ts:131`: `['ke_toan','giam_doc_kinh_doanh']`).

## Decision

1. **Sale gains `finance.receiptCreate` (draft-only).** The existing receipt flow already
   produces drafts by design; sale creates drafts, never approves. `receiptApprove` perm
   stays `ke_toan` / directors — the money gate is unchanged.

2. **Sale creates draft receipt from the opportunity detail page.** A "Tạo phiếu thu"
   button on `opportunity-detail.tsx` pre-fills student/course/classBatch and passes
   `opportunityId` through. `finance-panel.tsx` forwards `opportunityId` at both call
   sites.

3. **`receiptApprove` auto-advances the linked opportunity to O5_ENROLLED**, stamping
   `closedAt` and clearing `lostReason` (mirroring the manual `opportunityTransition` WON
   invariant, M2). The `kind` is computed treating a surviving linked opp as O5 **before**
   the stage update, so win-back receipts tag `new` correctly. Attribution-mismatch
   (studentName guard drops) → no advance. A LOST opp (`closedAt && lostReason`) → skip
   advance (never auto-"won").

4. **`receiptCancel` reverts the auto-advanced opp.** When a cancelled receipt was the
   only approved receipt that auto-advanced its linked opp, revert the opp to O4 + clear
   `closedAt` in the same cancel txn (M3). This keeps won metrics honest and unblocks
   manual re-work (the anti-regression guard `crm.ts:358` would otherwise block
   correction).

5. **Sale retains read-only visibility of own receipts.** New `finance.receiptListOwn`
   (scope key `collectedById = self`) lets sale view their own drafts + post-hand-off
   status. `finance.receiptList` and the finance nav gate stay unchanged — sale never sees
   the finance panel or others' receipts.

## Alternatives Considered

1. Keep sale out of receipt creation entirely. Rejected: the commission chain stays
   broken — no `opportunityId` link, no auto-O5, stale `kind`.
2. Let sale approve receipts. Rejected: breaks the money-approval gate; sale would control
   both creation and approval.
3. Auto-advance without stamping `closedAt`. Rejected: violates the WON invariant
   (`stage O5 && closedAt`); the opp becomes regressable and markLost-able, invisible to
   closedAt-based won metrics.

## Consequences

Positive:

- The full commission chain works via UI: sale draft → director approve → correct
  `soldById`/`kind` + opp auto → O5.
- Won metrics stay honest (closedAt stamped on advance, reverted on cancel).
- Sale retains read-only visibility without gaining approve/cancel power.

Tradeoffs:

- A fresh same-name opp attached to a renewal receipt reclasses `kind` to `new` (higher
  rate). Accepted for win-backs; mitigated by an adversarial int test + approver UI
  showing `kind` before approve (N4).
- `receiptCancel` now has an opp-revert side-write — must be tested to avoid stranding or
  double-reverting.

## Follow-Up

- Integration tests: new / win-back / mismatch-drop / sale-sees-own-receipt-post-approve +
  denied others' / LOST-same-name-no-auto-won / cancel-reverts-O5.
- Parity snapshot regen in P6 captures `finance.receiptCreate += sale` +
  `finance.receiptListOwn` (new).
