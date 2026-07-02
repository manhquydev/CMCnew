# Cross-Plan Integration Review: CRM → Receipt → Commission → Discount Tiers

Scope: apps/api/src/routers/finance.ts, apps/api/src/routers/payroll.ts,
packages/domain-payroll/src/commission.ts, apps/admin/src/{finance-panel,revenue-report,
reconcile-worklist,opportunity-detail}.tsx. No code changes made (review only).

## Findings

### Q1 — Cancel + refund vs O5_ENROLLED opportunity: NOT AN ISSUE
`receiptCancel` (finance.ts:1163-1192) already reverts `O5_ENROLLED → O4_TESTED` (clearing
`closedAt`/`lostReason`) whenever a wasApproved receipt tied to that opportunity is cancelled,
gated by `approvedOnOpp === 0` (no other live approved receipt still funding the win). This runs
unconditionally at cancel time — before any refund exists.

`refundCreate` (finance.ts:1281-1343) hard-requires `receipt.status === 'cancelled'` (line 1307),
so a refund can only ever be recorded *after* cancel has already run the opportunity-revert logic.
There is no separate/duplicate revert path inside refundCreate, and no window where a refund exists
against a receipt still holding the opportunity at O5. Decision 0028's refund ledger is correctly
downstream of, not parallel to, the O5-revert logic — no distinct "won deal refunded" case is
needed because cancel already owns that transition.

### Q2 — Commission attribution reads opportunityId: NOT AN ISSUE
Confirmed full data path: `receiptCreate` accepts `opportunityId` (finance.ts:488) →
`receiptApprove` resolves the opportunity, validates studentName match (mismatch drops credit,
finance.ts:982-1012), stamps `receipt.soldById = attributedOpp.ownerId` and `receipt.kind`
('new'/'renewal') at finance.ts:1040-1046 → `payroll.ts` (lines 244-251, 579-587, 1321-1328) groups
`receipt.findMany({ where: { soldById } })` by `kind` to compute new/renewal revenue feeding
`commissionAmount()` in packages/domain-payroll/src/commission.ts. No disconnect; commission calc
functions are pure and correctly fed real `soldById`/`kind` data stamped from the opportunity.

### Q3 — Discount-tier config affects new receiptCreate: NOT AN ISSUE
`receiptCreate` (finance.ts:513-517) calls `tiersFor(tx, input.facilityId)` → `tierPercentForYears`
→ `netAmount(gross, effective)`. `tiersFor` (finance.ts:29-37) reads `discountTier.findMany` for
that facility and only falls back to `DEFAULT_DISCOUNT_TIERS` when zero active rows exist. A
facility with custom tiers configured via `discountTierUpsert` will reprice live receiptCreate calls,
not just compute in isolation.

### Q4 — Orphaned UI/backend: NONE FOUND
Diffed every `requirePermission('finance', ...)` procedure key against every `trpc.finance.*` call
site in apps/admin/src and apps/lms/src — full match (one apparent mismatch, `revenueReportCsv`, is
an extraction artifact: that procedure's *permission key* is `'revenueReport'`, not a missing
binding — both `revenueReport` and `revenueReportCsv` are called in revenue-report.tsx:44,59).
finance-panel.tsx, reconcile-worklist.tsx, opportunity-detail.tsx all call procedures that exist and
are permission-gated as expected.

### Q5 — Revenue report vs commission: CONFIRMED INTENTIONAL SCOPE BOUNDARY
`revenueReport`/`revenueReportCsv` (finance.ts:1438-1457) aggregate only `receipt.netAmount` minus
`refundRecord.amount`, bucketed by `approvedAt`. No join to `soldById`, `payroll`, or commission
tables anywhere in the query. This is a pure cash-collection report; commission is entirely separate
accounting in `payroll.ts`. No plan text found requiring commission to be netted into this report —
this is a scope boundary, not an oversight. Not flagged as a bug.

## Summary
No integration gaps found across the five questions. All four plans' pieces (CRM auto-advance,
refund ledger, commission attribution, discount tiers) are correctly wired end-to-end at the code
level. The refund ledger's hard precondition (`status === 'cancelled'`) is the load-bearing design
choice that avoids the "won deal refunded" edge case entirely, by sequencing revert-then-refund
rather than needing two independent revert paths.

## Unresolved Questions
- None — all five integration questions were resolved with direct code evidence.
