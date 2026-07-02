# Phase 3 — Commission chain: sale draft receipt from opportunity + auto-O5 on approve

## Context links
- Brainstorm §2 Mạch tiền, D2; plan.md serialization (P3 permissions.ts edit FIRST of the three).
- Anchors (verified): `apps/admin/src/finance-panel.tsx:714,727` (receiptCreate calls — no opportunityId); `apps/api/src/routers/finance.ts:198,258` (API accepts opportunityId); `:608-668` (commission attribution + kind + soldById stamp at approve); `apps/admin/src/opportunity-detail.tsx` (host "Tạo phiếu thu" button); `packages/auth/src/permissions.ts:131` (`receiptCreate: ['ke_toan','giam_doc_kinh_doanh']`).

## Overview
Wire the commission chain end-to-end: give sale `finance.receiptCreate` (draft-only by existing design), add a "Tạo phiếu thu" button on the opportunity detail that pre-fills + passes opportunityId, make finance-panel forward opportunityId, and make receiptApprove auto-advance the linked opportunity to O5_ENROLLED — sequenced so commission `kind` reflects the advance.

## Key Insights
- **Control-flow trap (traced `finance.ts:648`)**: `const kind = attributedOpp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected>0 ? 'renewal' : 'new'`. If auto-advance to O5 runs AFTER this line, `kind` reads the stale (O4) stage. For a first-time student kind still resolves 'new' via the priorCollected fallback, but a win-back (priorCollected>0) linked opp that SHOULD be 'new' would be mis-tagged 'renewal'. **Fix ordering**: compute intended post-approve stage first — if `attributedOpp` present and not cancelled/lost, treat as O5 for `kind`, then persist the opp stage change in the same txn. Keep the studentName attribution-guard (`:626-644`) intact; only advance the opp when `attributedOpp` survived the guard (dropped attribution → no advance).
- Sale creates DRAFT only — no new approve power. `receiptApprove` perm unchanged (still ke_toan/directors). This keeps the money gate.
- opportunityId is already accepted server-side (`:198,:258`); the only gap is the two UI call sites never sending it and the missing host button.

## Requirements
- `permissions.ts:131` `receiptCreate` += `'sale'`.
- Opportunity detail hosts "Tạo phiếu thu" → opens receipt-create pre-filled with opportunityId (+ studentName/course where derivable).
- `finance-panel.tsx:714,727` forward `opportunityId` when present.
- `receiptApprove`: when linked opp survives attribution guard, advance stage → O5_ENROLLED (idempotent if already O5) within the approve txn, ordered before/consistent-with `kind` computation; audit the stage change.

## Architecture
- Data in: opportunity (O4) → draft receipt (opportunityId linked) → approve.
- Data out: approved receipt (soldById=opp.ownerId, kind), opportunity→O5, enrollment (existing `:521`), commission attribution frozen.
- Idempotency: opp already O5 → no-op advance, no duplicate audit noise (guard on stage change).

## Related code files
- `packages/auth/src/permissions.ts:131` (modify — SERIALIZE: this is the first of 3 permissions edits).
- `apps/admin/src/opportunity-detail.tsx` (modify — add button + wire).
- `apps/admin/src/finance-panel.tsx:714,727` (modify — pass opportunityId).
- `apps/api/src/routers/finance.ts:608-668` (modify — auto-advance + kind ordering).

## Implementation Steps
1. Add `'sale'` to `receiptCreate` roles.
2. finance-panel: include `opportunityId` in both receiptCreate payloads when set.
3. opportunity-detail: "Tạo phiếu thu" button (visible to receiptCreate-capable roles) opening the create flow with opportunityId + prefill.
4. finance.ts receiptApprove: after attribution guard resolves `attributedOpp`, compute `kind` treating a surviving linked opp as O5; then `tx.opportunity.update` stage→O5_ENROLLED when `attributedOpp && stage !== 'O5_ENROLLED'`; logEvent stage change.
5. Int test (UI-path, no hand-called API): sale login → create draft on O4 opp → director approve → assert soldById=ownerId, kind='new', opp.stage='O5_ENROLLED'; win-back case → kind='new'; mismatched studentName → attribution dropped + no advance.

## Todo list
- [ ] permissions.ts receiptCreate += sale (serialized edit #1)
- [ ] finance-panel pass opportunityId (both call sites)
- [ ] opportunity-detail "Tạo phiếu thu" button + prefill
- [ ] receiptApprove auto-O5 with correct kind ordering + audit
- [ ] int tests: new / win-back / mismatch-drop

## Success Criteria
- Success criterion §6.1 met: full chain via UI, correct attribution, opp auto→O5.
- Attribution-mismatch still drops commission AND skips advance (no wrong O5).
- Approving an already-O5 opp is a no-op (no duplicate audit).

## Risk Assessment
- kind mis-tag from ordering — Med×High. Mitigated by explicit ordering + win-back int test.
- Sale draft on someone else's opportunity → cross-facility credit — Med×Med. receiptCreate is facility-scoped; opportunityId attribution guard (studentName) already prevents mis-credit; test cross-facility denial.
- Stage regression (advancing an opp already past O5 / lost) — Low×Med. Only advance from pre-O5 non-terminal stages; do not downgrade.

## Security Considerations
- No new sensitive data. Draft-only power for sale keeps money approval gated.

## Rollback
- Permission: remove `'sale'` from receiptCreate (snapshot regen). UI button hidden by perm automatically.
- receiptApprove auto-advance: guarded + idempotent; revert = remove the stage-update block (kind falls back to prior behavior).

## Next steps
- P4 next in the serialized permissions.ts sequence.
