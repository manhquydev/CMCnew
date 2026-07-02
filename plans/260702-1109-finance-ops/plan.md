---
title: "Finance ops: refund ledger + email ops + revenue reporting"
description: "Close the money-out gap (manual refund ledger on cancel), give email outbox an admin surface + receipt email, add revenue reporting + reconciliation worklist, and a discount-tier config UI."
status: pending
priority: P1
effort: 4-5d
branch: develop
tags: [finance, refund, email, reporting]
created: 2026-07-02
---

# Finance Ops (Plan 4)

Source of truth: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md` (§PLAN 4 + Quyết định operator, FINAL — do not re-litigate). Decision **D-P4a**: refund ledger = MANUAL amount entry; pro-rata auto-calc is DEBT.

## Lane & Intake (HIGH-RISK — FEATURE_INTAKE hard gates)

Hard gates tripped: **Data model** (new `RefundRecord` model + migration), **Audit/security** (money-out records + email outbox exposes rendered bodies), **Existing behavior** (`receiptCancel` gains a refund side-write; `receiptCreate` notif recipient changes). ≥3 flags + hard gates → high-risk lane.

Required durable artifacts (checkpoints, NOT code):
- High-risk story folder from `docs/templates/high-risk-story/` (execplan/overview/design/validation).
- **1 decision record** (next free id **0028** — 0023 latest, Plan 3 reserves 0024–0027):
  - 0028 refund-ledger: refund is a manual amount + reason + payer bound to the cancelled receipt; no auto pro-rata; refund never mutates receipt.netAmount (audit-preserving); RefundRecord is append-only (reversible only by a compensating negative entry, not delete).
- Harness: `harness-cli intake` → `story add`/`story update` per phase → `harness-cli decision add 0028` → `harness-cli trace` at each phase close. Every DB phase ends 0-drift (`prisma migrate diff` clean).

## Dependency

**Runs AFTER Plan 3 `260702-1030`.** Both edit `apps/admin/src/finance-panel.tsx` and `packages/auth/src/permissions.ts` (`finance.*`) — serialize, do not run concurrently. Rebase onto Plan 3's merged state before starting P1.

## Phases

| # | Phase | Status | Link |
|---|-------|--------|------|
| P1 | RefundRecord model + migration + refund router + cancel-flow UI + audit | pending | [phase-01-refund-ledger.md](phase-01-refund-ledger.md) |
| P2 | Email ops: outbox admin surface + retry guard + `receipt` template + send-by-email + notif fix | pending | [phase-02-email-ops.md](phase-02-email-ops.md) |
| P3 | Revenue report (month/facility/course + CSV) + reconciliation period worklist | pending | [phase-03-revenue-reconcile.md](phase-03-revenue-reconcile.md) |
| P4 | Discount-tier config UI (model exists, no migration) + 35% cap | pending | [phase-04-discount-tier-ui.md](phase-04-discount-tier-ui.md) |
| P5 | Validation: int + e2e + decision 0028 + DEBT + harness trace + 0-drift | pending | [phase-05-validation.md](phase-05-validation.md) |

## Dependency graph

```
Plan 3 (260702-1030) merged ──► P1 refund ledger (owns finance-panel.tsx + permissions this cycle)
                                   │
                    ┌──────────────┼───────────────┐
                    ▼              ▼                ▼
             P2 email ops   P3 revenue/recon   P4 discount UI
             (no schema)    (new components)   (finance-panel — after P1)
                    └──────────────┴───────────────┘
                                   ▼
                              P5 validation
```

File-ownership rule: **P1 owns all `finance-panel.tsx` + `permissions.ts` edits this cycle.** P4 adds its discount section only after P1 lands (serialize same-file). P2 owns `email-*.ts` + new `email` router. P3 adds new report/worklist components + `dashboard`/report router procs (no finance-panel edit).

## Success criteria (go-live)

1. Every đồng out has a record: cancelling an approved receipt captures a `RefundRecord` (amount+reason+payer+audit).
2. A stuck/failed provisioning email is visible + retryable; secret-scrubbed rows warn instead of sending blank.
3. A receipt can be emailed to the parent; the `receipt_pending_approval` notif reaches a real recipient (GĐKD).
4. Monthly/facility/course revenue exports to CSV; a "chưa đối soát kỳ này" worklist exists.
5. Discount tiers are editable per facility, 35% cap enforced.

## Next steps

Execute P1 → P5 in order (P2–P4 may parallelize only under the file-ownership rule). Do not start before Plan 3 is merged.
