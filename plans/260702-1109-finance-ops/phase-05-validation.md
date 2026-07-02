# Phase 5 — Validation (int + e2e + decision 0028 + DEBT + harness trace + 0-drift)

## Context links
- Report §PLAN 4 (all items) + Quyết định operator (D-P4a manual refund; pro-rata = DEBT).
- Plan: `plan.md` (high-risk lane, decision 0028 refund-ledger, harness gates).
- Phases: `phase-01-refund-ledger.md` .. `phase-04-discount-tier-ui.md`.
- Existing int-test pattern: `apps/api/test/email-outbox.int.test.ts` (uses `withRls`, `uniq`, `fetchReturning`).
- Decision template: `docs/templates/decision.md`; latest id 0023, Plan 3 reserves 0024-0027 → this plan uses **0028**.

## Overview
Final gate: prove every money/email/report path from P1-P4 works, RLS holds, migrations are 0-drift, the refund-ledger decision is recorded, deferred items are captured as DEBT, and the harness trace is written. No new feature code — tests, the decision record, DEBT entries, and harness bookkeeping only.

## Key Insights
- **Int tests over unit**: the risk is RLS + txn atomicity + guard logic, which only integration (real DB, real `withRls`) exercises. Follow the existing `email-outbox.int.test.ts` harness pattern.
- **e2e is thin in this repo** (~1 real file) — add focused e2e only for the two highest-value money flows (cancel→refund; send-receipt email visible+retryable), not a broad matrix.
- **Decision 0028 must be a durable record**, not just trace text (per FEATURE_INTAKE hard-gate): `docs/decisions/0028-*.md` + `harness-cli decision add 0028`.
- **0-drift is a hard close condition** for the DB phase (P1): `prisma migrate diff` must be clean after the refund_record migration applies.

## Requirements
- **Integration tests**:
  - P1: cancel an approved receipt + refundCreate → RefundRecord written, `receipt.netAmount` UNCHANGED, audit event present; sum-cap guard rejects `sum+amount > netAmount`; cross-facility read blocked (RLS parity with receipt).
  - P2: retry a non-secret failed outbox row → re-queued; retry a scrubbed-secret (`bodyHtml=''`, kind∈SECRET_KINDS) row → REJECTED; `sendReceiptEmail` enqueues once, dedupKey re-send = no-op; `receipt_pending_approval` recipients = GĐKD (not ke_toan).
  - P3: `revenueReport` sum matches raw receipt sum for a seeded period per groupBy; CSV header + VND formatting; `reconcileWorklist` returns only un-reconciled in-period; reconcile flip removes a row; RLS scoping.
  - P4: `discountTierUpsert` rejects percent > 35; upsert on (facility,years); archive soft; a configured facility reprices vs defaults; cross-facility RLS.
- **e2e** (2 flows): (a) cancel approved receipt → enter refund amount → RefundRecord + audit visible; (b) send receipt email → appears in outbox surface → simulate failure → retry path.
- **Decision 0028**: write `docs/decisions/0028-refund-ledger-manual-append-only.md` from template (manual amount + reason + payer bound to cancelled receipt; no auto pro-rata; never mutates netAmount; append-only, correction = compensating negative row). Then `harness-cli decision add 0028`.
- **DEBT capture** (`docs/DEBT.md` or repo DEBT surface): pro-rata auto-calc refund (deferred per D-P4a); any batch-reconcile deferral; MAES/leaderboard already tracked elsewhere (do not duplicate).
- **Harness**: `harness-cli intake` recorded; `story update` per phase to proof status; `harness-cli trace` at each phase close; final `prisma migrate diff` clean (0-drift).

## Architecture
Validation flow: seed (facility + payer + approved receipt) → run int tests per phase against real DB via `withRls` → run 2 e2e flows → assert audit + RLS + 0-drift → record decision 0028 + DEBT → `harness-cli trace`. Test data isolated per-run (`uniq` helper) so parallel int runs don't collide.

## Related code files
- CREATE `apps/api/test/refund-ledger.int.test.ts` (P1).
- CREATE `apps/api/test/email-ops.int.test.ts` (P2 — outbox retry guard + sendReceiptEmail + notif recipient).
- CREATE `apps/api/test/revenue-reconcile.int.test.ts` (P3).
- CREATE `apps/api/test/discount-tier.int.test.ts` (P4).
- CREATE/EXTEND e2e spec for the 2 money flows (match existing e2e location).
- CREATE `docs/decisions/0028-refund-ledger-manual-append-only.md`.
- MODIFY DEBT surface + harness durable records (no product code).

## Implementation Steps
1. Write int tests per phase against the seed fixture; assert audit + RLS + guard rejections.
2. Add the 2 e2e flows.
3. Run full suite; fix regressions (do not weaken tests).
4. Run `prisma migrate diff` → confirm 0-drift on the refund_record migration.
5. Write decision 0028 + `harness-cli decision add`; capture DEBT; `harness-cli trace` each phase close.

## Todo list
- [ ] P1 refund int test (netAmount unchanged, cap guard, RLS)
- [ ] P2 email-ops int test (retry guard, dedup, notif recipient)
- [ ] P3 revenue/reconcile int test (sum parity, CSV, worklist, RLS)
- [ ] P4 discount-tier int test (cap, upsert, archive, reprice, RLS)
- [ ] 2 e2e money flows
- [ ] decision 0028 recorded (file + harness)
- [ ] DEBT captured (pro-rata; any batch-reconcile deferral)
- [ ] harness trace per phase + 0-drift confirmed

## Success Criteria
- All int + e2e green; no test weakened to pass.
- `prisma migrate diff` clean (0-drift) after refund_record.
- Decision 0028 exists as a durable record (file + `harness-cli decision add`).
- Every go-live success criterion in `plan.md` is covered by at least one test.
- DEBT surface lists pro-rata refund (and any other deferral) with rationale.

## Risk Assessment
- **Flaky RLS tests (Med)**: shared DB state → use `uniq`/isolated fixtures per run (existing pattern).
- **e2e brittleness (Med)**: thin e2e base → keep to 2 high-value flows, stable selectors.
- **Missed hard-gate artifact (Low×High)**: forgetting decision 0028 as a durable record fails the high-risk gate → explicit todo + harness check.
- **Drift slipping through (Low×High)**: skipping `migrate diff` → mandatory close step.

## Security Considerations
- Tests assert RLS blocks cross-facility reads on refunds, tiers, reports, and outbox rows.
- Tests assert scrubbed-secret retry never sends a body; `paidById` is server-derived.
- No secrets or real PII in fixtures.

## Rollback
- Tests/docs/harness only — no product rollback. Reverting a phase reverts its tests with it.

## Next steps
Plan complete → open PR into `main` (branch `develop`). Confirm Plan 3 merged first (shared finance-panel/permissions). Re-run `npx gitnexus analyze` post-merge to refresh the index.
