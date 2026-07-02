# Phase 3 — Commission chain: sale draft receipt from opportunity + auto-O5 on approve

## Context links
- Brainstorm §2 Mạch tiền, D2; plan.md serialization (P3 permissions.ts edit FIRST of the three).
- Anchors (verified): `apps/admin/src/finance-panel.tsx:714,727` (receiptCreate calls — no opportunityId); `apps/api/src/routers/finance.ts:198,258` (API accepts opportunityId); `:608-668` (commission attribution + kind + soldById stamp at approve); `apps/admin/src/opportunity-detail.tsx` (host "Tạo phiếu thu" button); `packages/auth/src/permissions.ts:131` (`receiptCreate: ['ke_toan','giam_doc_kinh_doanh']`).

## Overview
Wire the commission chain end-to-end: give sale `finance.receiptCreate` (draft-only by existing design), add a "Tạo phiếu thu" button on the opportunity detail that pre-fills + passes opportunityId, make finance-panel forward opportunityId, and make receiptApprove auto-advance the linked opportunity to O5_ENROLLED — sequenced so commission `kind` reflects the advance.

## Key Insights
- **Control-flow trap (traced `finance.ts:648`)**: `const kind = attributedOpp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected>0 ? 'renewal' : 'new'`. If auto-advance to O5 runs AFTER this line, `kind` reads the stale (O4) stage. For a first-time student kind still resolves 'new' via the priorCollected fallback, but a win-back (priorCollected>0) linked opp that SHOULD be 'new' would be mis-tagged 'renewal'. **Fix ordering**: compute intended post-approve stage first — if `attributedOpp` present and not lost, treat as O5 for `kind`, then persist the opp stage change in the same txn. Keep the studentName attribution-guard (`:626-644`) intact; only advance the opp when `attributedOpp` survived the guard (dropped attribution → no advance).
- **M2 — auto-O5 must honor the WON invariant.** In CRM, "won" = `stage O5_ENROLLED && closedAt set`; that pair drives the anti-regression guard (`crm.ts:358`) and anti-markLost guard (`:390`); manual `opportunityTransition` stamps `closedAt` + clears `lostReason` on advance (`:365-366`). The current auto-advance select at `finance.ts:612-617` pulls ONLY `ownerId, stage, studentName`. Fixes: (a) EXTEND the select to `closedAt, lostReason`; (b) on advance, STAMP `closedAt` (mirror manual O5) and clear `lostReason`, otherwise you get a regressable/markLost-able O5 invisible to closedAt-based won metrics; (c) a LOST opp = `closedAt && lostReason` with stage frozen at e.g. O4 (`:398`) — SKIP the advance (and drop stage-based `kind`) when `closedAt && lostReason`, so a lost same-name opp is never auto-"won".
- **M3 — receiptCancel must unwind the phantom-won opp.** Cancel (`finance.ts:727-845`) refunds voucher + rolls back student/enrollment but never touches the opportunity; commission claw-back is status-filtered (comment `:735-736`) but stage is not. After auto-O5, cancelling strands the opp at O5+closedAt with zero revenue, and the anti-regression guard (`:358`) blocks manual correction. Rule: when a cancelled receipt was the receipt that auto-advanced its linked opp to O5 (i.e. the only approved receipt on it), REVERT the opp to O4 and clear closedAt in the same cancel txn; audit it. This keeps won metrics honest and unblocks manual re-work.
- Sale creates DRAFT only — no new approve power. `receiptApprove` perm unchanged (still ke_toan/directors). This keeps the money gate.
- opportunityId is already accepted server-side (`:198,:258`); the only gap is the two UI call sites never sending it and the missing host button.

## Requirements
- `permissions.ts:131` `receiptCreate` += `'sale'`.
- **Sale read-only visibility (N3 resolved, operator 2026-07-02).** Sale may VIEW receipts they created as draft, even after hand-off to ke_toan/director. Scope key = `collectedById = self` (draft-create stamps `collectedById: ctx.session.userId` at `finance.ts:257`; Receipt has NO `createdById`/`soldById` yet — `soldById` is only set at approve). Add narrow read `finance.receiptListOwn: ['sale','ke_toan','giam_doc_kinh_doanh']`; a query self-scoped server-side to `collectedById = ctx.session.userId` (optional `opportunityId` filter), returns status/amounts — list only, NO update/approve/cancel. **Do NOT add `sale` to `finance.receiptList`**: nav-permissions.ts:79 gates the whole finance nav on `receiptList`, and finance-panel fires `priceList`/`voucherList` (ke_toan/director-only) on load → adding sale would surface the panel + 403-cascade. Surface the own-receipt status on `opportunity-detail.tsx` (P3-owned), read-only.
- Opportunity detail hosts "Tạo phiếu thu" → opens receipt-create pre-filled with opportunityId (+ studentName/course where derivable).
- `finance-panel.tsx:714,727` forward `opportunityId` when present.
- `receiptApprove`: extend opp select with `closedAt, lostReason`; when linked opp survives attribution guard AND is not lost (`!(closedAt && lostReason)`), advance stage → O5_ENROLLED + STAMP closedAt + clear lostReason (idempotent if already O5) within the approve txn, ordered before/consistent-with `kind` computation; audit the stage change.
- `receiptCancel`: when the cancelled receipt was the one that auto-advanced its linked opp to O5 (only approved receipt on that opp), revert opp → O4 + clear closedAt in the cancel txn; audit. (M3)

## Architecture
- Data in: opportunity (O4) → draft receipt (opportunityId linked) → approve.
- Data out: approved receipt (soldById=opp.ownerId, kind), opportunity→O5, enrollment (existing `:521`), commission attribution frozen.
- Idempotency: opp already O5 → no-op advance, no duplicate audit noise (guard on stage change).

## Related code files
- `packages/auth/src/permissions.ts:131` (modify — SERIALIZE: first of 3 permissions edits; adds BOTH `receiptCreate += sale` AND new `receiptListOwn` key — same commit, snapshot M7 diff = 2 finance keys).
- `apps/api/src/routers/finance.ts` (modify — add `receiptListOwn` query, self-scoped to `collectedById = ctx.session.userId`, optional opportunityId filter, read-only).
- `apps/admin/src/opportunity-detail.tsx` (modify — add button + wire + read-only linked-receipt status via receiptListOwn).
- `apps/admin/src/finance-panel.tsx:714,727` (modify — pass opportunityId).
- `apps/api/src/routers/finance.ts:608-668` (modify — extend opp select + auto-advance w/ closedAt + kind ordering), `:727-845` (modify — receiptCancel opp-revert path, M3).

## Implementation Steps
1. Add `'sale'` to `receiptCreate` roles AND add `receiptListOwn: ['sale','ke_toan','giam_doc_kinh_doanh']`.
1b. finance.ts: add `receiptListOwn` query — WHERE `collectedById = ctx.session.userId` (+ optional `opportunityId`), `take 100` desc, read-only; keep withRls facility scope.
2. finance-panel: include `opportunityId` in both receiptCreate payloads when set.
3. opportunity-detail: "Tạo phiếu thu" button (visible to receiptCreate-capable roles) opening the create flow with opportunityId + prefill; render linked-receipt status (via receiptListOwn, this opp) read-only so sale sees post-hand-off progress.
4. finance.ts receiptApprove: extend opp select (`closedAt, lostReason`); after attribution guard resolves `attributedOpp`, SKIP advance when `closedAt && lostReason` (lost); else compute `kind` treating a surviving linked opp as O5, then `tx.opportunity.update` stage→O5_ENROLLED + closedAt + clear lostReason when `attributedOpp && stage !== 'O5_ENROLLED'`; logEvent stage change.
5. finance.ts receiptCancel: if cancelled receipt auto-advanced its opp (only approved receipt on it) → revert opp to O4 + clear closedAt + audit (M3).
6. Int test (UI-path, no hand-called API): sale login → create draft on O4 opp → director approve → assert soldById=ownerId, kind='new', opp.stage='O5_ENROLLED' AND closedAt set; win-back case → kind='new'; mismatched studentName → attribution dropped + no advance; LOST same-name opp → no auto-won; cancel auto-won receipt → opp reverts to O4 (closedAt cleared); adversarial (N4): renewal receipt + freshly-linked same-name opp → approver UI shows `kind` before approve.

## Todo list
- [ ] permissions.ts receiptCreate += sale AND receiptListOwn added (serialized edit #1)
- [ ] finance.ts receiptListOwn query (collectedById=self, read-only)
- [ ] finance-panel pass opportunityId (both call sites)
- [ ] opportunity-detail "Tạo phiếu thu" button + prefill + read-only linked-receipt status
- [ ] receiptApprove auto-O5 with correct kind ordering + audit
- [ ] int tests: new / win-back / mismatch-drop / sale-sees-own-receipt-post-approve + denied others'

## Success Criteria
- Success criterion §6.1 met: full chain via UI, correct attribution, opp auto→O5.
- Attribution-mismatch still drops commission AND skips advance (no wrong O5).
- Approving an already-O5 opp is a no-op (no duplicate audit).
- Sale can VIEW own receipts (collectedById=self) via receiptListOwn incl. status after hand-off; CANNOT view others' receipts, and has no update/approve/cancel. Finance nav/panel stays hidden from sale (receiptList unchanged).

## Risk Assessment
- kind mis-tag from ordering — Med×High. Mitigated by explicit ordering + win-back int test.
- Sale draft on someone else's opportunity → cross-facility credit — Med×Med. receiptCreate is facility-scoped; opportunityId attribution guard (studentName) already prevents mis-credit; test cross-facility denial.
- Stage regression (advancing an opp already past O5 / lost) — Low×Med. Only advance from pre-O5 non-terminal stages; skip lost (`closedAt && lostReason`); do not downgrade.
- WON-invariant violation (auto-O5 without closedAt) — was MAJOR (M2). Stamp closedAt on advance; extend select; skip lost. Test: won metrics + anti-markLost hold.
- Phantom-won after cancel — was MAJOR (M3). Cancel reverts the auto-advanced opp; test covers it.
- N3 (sale visibility): RESOLVED (operator 2026-07-02) — grant scoped read-only visibility. Sale gets `finance.receiptListOwn` self-scoped to `collectedById = self` (own drafts + their post-hand-off status), surfaced on opportunity-detail; `finance.receiptList` and the finance nav gate (`nav-permissions.ts:79`) stay unchanged so the finance panel + its ke_toan-only priceList/voucherList queries never leak to sale. Create flow stays self-contained in opportunity-detail (course/classBatch/student protectedProcedure, price server-side, voucher text input — data deps OK).
- N4 (kind='new' forcing vector): a fresh same-name opp attached to a renewal receipt reclasses it 'new' (higher rate). Accepted design for win-backs (`finance.ts:608-611`); mitigate with the adversarial int test + approver UI showing `kind` before approve.

## Security Considerations
- No new sensitive data. Draft-only power for sale keeps money approval gated.

## Rollback
- Permission: remove `'sale'` from receiptCreate (snapshot regen). UI button hidden by perm automatically.
- receiptApprove auto-advance: guarded + idempotent; revert = remove the stage-update block (kind falls back to prior behavior).

## Next steps
- P4 next in the serialized permissions.ts sequence.
