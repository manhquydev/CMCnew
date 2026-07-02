# Phase 3 — Revenue Report + Reconciliation Period Worklist

## Context links
- Report §PLAN 4.3 (revenue report) + §PLAN 4.4 (đối soát theo kỳ).
- Current revenue: `apps/api/src/routers/dashboard.ts:148-178` (`dashboard.summary` — all-time `revenueTotal` only, no period/facility/course breakdown).
- Reconcile (per-receipt): `apps/api/src/routers/finance.ts:702-720` (flip to `reconciled` + `reconciledAt`/`reconcileNote`, single receipt). UI `apps/admin/src/finance-panel.tsx:592-596`.
- Receipt shape for grouping: `receipt.status IN (approved,sent,reconciled)`, `netAmount`, `facilityId`, `approvedAt` (period key — see below), `courseId` DIRECT FK (`schema.prisma:1030-1031`; 1 receipt = 1 course, no double-count).
- Period key: `Receipt.issuedAt` DOES NOT EXIST (`issuedAt` is only on `Certificate` `schema.prisma:1303`). Receipt timestamps are `createdAt`/`approvedAt`/`sentAt`/`reconciledAt` (`schema.prisma:1053-1059`). Use `approvedAt` as the period key (money accepted + code allocated at approval). Every qualifying row (`status IN approved,sent,reconciled`) has a non-null `approvedAt`.
- Refund ledger (from P1): `RefundRecord.amount` + `createdAt` — the actual cash-out events, needed for NET revenue.
- Perms: `packages/auth/src/permissions.ts` (`finance.*`).

## Overview
There is no revenue reporting beyond an all-time total and no way to see which receipts remain un-reconciled for a period. This phase adds: (1) a revenue report grouped by month / facility / course with CSV export, (2) a "chưa đối soát kỳ này" worklist listing approved/sent (not-yet-reconciled) receipts for a chosen period, feeding the existing per-receipt reconcile flip. Read-only aggregation — no new schema, no money mutation.

## Key Insights
- **No schema change**: everything is aggregation over existing `Receipt` + `RefundRecord`. Grouping keys already exist: month via `approvedAt` (NOT `issuedAt` — does not exist on Receipt), `facilityId`, `courseId` (direct FK, no enrollment join).
- **NET revenue**: the report must subtract P1's `RefundRecord` amounts. Gross = SUM(netAmount) of qualifying receipts by `approvedAt`; refunds = SUM(RefundRecord.amount) by refund `createdAt`; net = gross − refunds. A report that ignores refunds misstates cash-out.
- **Cancellation is retroactively subtractive** (expected accounting behavior, NOT a bug): a receipt approved in June and cancelled in August leaves June's gross (`status` no longer qualifies) → June's reported total changes when re-run in August. State explicitly in the report note / decision 0028: net-revenue figures reflect the CURRENT ledger state, not a point-in-time snapshot; a June CSV exported in June is not byte-reproducible in August. This is intended — the report is a live ledger view, not an immutable period artifact.
- **Reconcile flip already exists** (`finance.ts:702`). The worklist does NOT add a new mutation — it filters receipts where `status IN (approved,sent)` (i.e. NOT `reconciled`, NOT `cancelled`) within a period, and reuses the existing flip per row (or a small batch wrapper calling the same guarded path).
- **CSV on the server** keeps number/locale formatting (VND, month keys) consistent and avoids a client CSV lib; return a text/csv string or rows the client serializes — pick server-side string for a single source of truth.
- **RLS does the facility scoping**: `withRls` already restricts rows to the user's facilities; "by facility" grouping is safe and only shows permitted facilities.

## Requirements
- New perms `finance.revenueReport`, `finance.reconcileWorklist` → reuse the `finance.*` grantee set (`ke_toan`, `giam_doc_kinh_doanh`).
- Query `finance.revenueReport({ from, to, groupBy: 'month'|'facility'|'course' })`: aggregates over `status IN (approved,sent,reconciled)` bucketed by `approvedAt` within `[from,to)`, grouped by the chosen key (`month` from approvedAt, `facilityId`, or `courseId` direct FK). Returns ordered rows `{ key, label, gross, refunds, net, count }` where `refunds` = SUM(RefundRecord.amount) for that bucket (by refund `createdAt`) and `net = gross − refunds`. RLS-scoped.
- Query/export `finance.revenueReportCsv({ ...same filters })` (or a `format:'csv'` flag): returns a CSV string with a header row + BOM for Excel-vi (UTF-8), amounts as integer VND, columns `key,label,gross,refunds,net,count` (deterministic order).
- Query `finance.reconcileWorklist({ from, to, facilityId? })`: lists receipts `status IN (approved,sent)` (un-reconciled) in the period bucketed by `approvedAt` (same key as the report) — id, receiptCode, netAmount, facility, approvedAt, status. Ordered oldest-first. RLS-scoped.
- UI: a revenue report view (period picker + groupBy toggle + table + "Xuất CSV" button) and a reconciliation worklist (period picker + table + per-row "Đối soát" action reusing the existing flip). New components — do NOT edit `finance-panel.tsx` (owned by P1); place under new files or a new report route.
- Optional batch reconcile: a "đối soát tất cả kỳ này" that loops the existing per-receipt flip inside one txn (each still guarded); if scope-risky, keep per-row only (YAGNI) — decide during build, default per-row.

## Architecture
Data flow (report): report view → `finance.revenueReport`/`...Csv` → `withRls` aggregate over Receipt (gross by `approvedAt`) + RefundRecord (refunds by `createdAt`) → grouped `{gross, refunds, net}` rows / CSV string → table + download. Data flow (worklist): worklist view → `finance.reconcileWorklist` (filter un-reconciled in period by approvedAt) → per-row `finance.reconcile` (EXISTING flip at :702) → row leaves the list. No schema, no new money path. Grouping by course uses the DIRECT `Receipt.courseId` FK (`schema.prisma:1030-1031`) — 1 receipt = 1 course, no enrollment join, no double-count.

## Related code files
- MODIFY `apps/api/src/routers/finance.ts` (add `revenueReport`, `revenueReportCsv`, `reconcileWorklist` — read-only; reuse existing `reconcile`).
- MODIFY `packages/auth/src/permissions.ts` (2 new perms).
- CREATE report + worklist components (e.g. `apps/admin/src/revenue-report.tsx`, `apps/admin/src/reconcile-worklist.tsx`) + route entries.
- (No schema, no migration.)

## Implementation Steps
1. Use `Receipt.courseId` direct FK for course grouping; commit to `approvedAt` as the period key (issuedAt does not exist on Receipt).
2. Add `revenueReport` aggregate (month/facility/course) with gross − refunds = net (join RefundRecord by createdAt bucket) + perms.
3. Add CSV export (server-side string, UTF-8 BOM, integer VND, gross/refunds/net columns).
4. Add `reconcileWorklist` (un-reconciled in period).
5. Build report + worklist UIs; wire worklist rows to the existing `reconcile` flip.

## Todo list
- [ ] period key = approvedAt; course grouping via direct courseId FK
- [ ] `revenueReport` aggregate (gross − refunds = net) + perms
- [ ] CSV export (BOM, VND, gross/refunds/net columns)
- [ ] `reconcileWorklist` query (approvedAt-bucketed)
- [ ] report + worklist UIs (reuse existing reconcile flip)
- [ ] document retroactive-cancel semantics (live ledger, non-reproducible exports) in report note + decision 0028

## Success Criteria
- Gross by month/facility/course = sum of qualifying receipts by approvedAt; net = gross − RefundRecord amounts for the bucket (verified against a seeded refund).
- CSV opens cleanly in Excel-vi with correct VND numbers and gross/refunds/net columns in fixed order.
- A receipt cancelled after its approval month drops from that month's gross on re-run — asserted as expected behavior, with the non-reproducibility note documented.
- The worklist shows exactly the un-reconciled (approved/sent) receipts for the chosen period; reconciling one removes it from the list.
- All queries RLS-scoped: a facility user sees only their facilities' figures.

## Risk Assessment
- **Wrong period key (Med×High)**: `issuedAt` does not exist on Receipt; `createdAt` (draft time) skews revenue to entry date → use `approvedAt` (recognition at approval), documented.
- **Refund-blind report (Med×High)**: omitting RefundRecord overstates cash-out → net column subtracts refunds by createdAt bucket; tested against a seeded refund.
- **Course grouping (Low)**: `Receipt.courseId` is a direct FK, 1:1 — no double-count, no enrollment join needed.
- **CSV injection / encoding (Low×Med)**: cells starting with `=`/`+`/`-`/`@` → prefix-guard; BOM for vi diacritics.
- **Large export (Low)**: unbounded period → cap the range or paginate; report the row count.

## Security Considerations
- Read-only; no money mutation added (worklist reuses the existing guarded flip).
- RLS enforces facility scope on every aggregate and export.
- CSV sanitized against formula injection.

## Rollback
- No schema. Revert router additions + remove new components/routes. The existing `reconcile` flip is untouched.

## Next steps
P4 (discount-tier config UI) — model already exists, no migration; edits `finance-panel.tsx` so SERIALIZE after P1.
