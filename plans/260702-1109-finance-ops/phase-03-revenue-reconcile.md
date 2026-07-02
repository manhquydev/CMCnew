# Phase 3 — Revenue Report + Reconciliation Period Worklist

## Context links
- Report §PLAN 4.3 (revenue report) + §PLAN 4.4 (đối soát theo kỳ).
- Current revenue: `apps/api/src/routers/dashboard.ts:148-178` (`dashboard.summary` — all-time `revenueTotal` only, no period/facility/course breakdown).
- Reconcile (per-receipt): `apps/api/src/routers/finance.ts:702-720` (flip to `reconciled` + `reconciledAt`/`reconcileNote`, single receipt). UI `apps/admin/src/finance-panel.tsx:592-596`.
- Receipt shape for grouping: `receipt.status IN (approved,sent,reconciled)`, `netAmount`, `facilityId`, course link (verify via receipt→enrollment→course path).
- Perms: `packages/auth/src/permissions.ts` (`finance.*`).

## Overview
There is no revenue reporting beyond an all-time total and no way to see which receipts remain un-reconciled for a period. This phase adds: (1) a revenue report grouped by month / facility / course with CSV export, (2) a "chưa đối soát kỳ này" worklist listing approved/sent (not-yet-reconciled) receipts for a chosen period, feeding the existing per-receipt reconcile flip. Read-only aggregation — no new schema, no money mutation.

## Key Insights
- **No schema change**: everything is aggregation over existing `Receipt`. Grouping keys already exist (`createdAt`/`issuedAt` for month, `facilityId`, course via enrollment).
- **Reconcile flip already exists** (`finance.ts:702`). The worklist does NOT add a new mutation — it filters receipts where `status IN (approved,sent)` (i.e. NOT `reconciled`, NOT `cancelled`) within a period, and reuses the existing flip per row (or a small batch wrapper calling the same guarded path).
- **CSV on the server** keeps number/locale formatting (VND, month keys) consistent and avoids a client CSV lib; return a text/csv string or rows the client serializes — pick server-side string for a single source of truth.
- **RLS does the facility scoping**: `withRls` already restricts rows to the user's facilities; "by facility" grouping is safe and only shows permitted facilities.

## Requirements
- New perms `finance.revenueReport`, `finance.reconcileWorklist` → reuse the `finance.*` grantee set (`ke_toan`, `giam_doc_kinh_doanh`).
- Query `finance.revenueReport({ from, to, groupBy: 'month'|'facility'|'course' })`: aggregates `SUM(netAmount)` + count over `status IN (approved,sent,reconciled)` within `[from,to)`, grouped by the chosen key. Returns ordered rows `{ key, label, total, count }`. RLS-scoped.
- Query/export `finance.revenueReportCsv({ ...same filters })` (or a `format:'csv'` flag): returns a CSV string with a header row + BOM for Excel-vi (UTF-8), amounts as integer VND. Deterministic column order.
- Query `finance.reconcileWorklist({ from, to, facilityId? })`: lists receipts `status IN (approved,sent)` (un-reconciled) in the period — id, receiptCode, netAmount, facility, createdAt, status. Ordered oldest-first. RLS-scoped.
- UI: a revenue report view (period picker + groupBy toggle + table + "Xuất CSV" button) and a reconciliation worklist (period picker + table + per-row "Đối soát" action reusing the existing flip). New components — do NOT edit `finance-panel.tsx` (owned by P1); place under new files or a new report route.
- Optional batch reconcile: a "đối soát tất cả kỳ này" that loops the existing per-receipt flip inside one txn (each still guarded); if scope-risky, keep per-row only (YAGNI) — decide during build, default per-row.

## Architecture
Data flow (report): report view → `finance.revenueReport`/`...Csv` → `withRls` aggregate over Receipt → grouped rows / CSV string → table + download. Data flow (worklist): worklist view → `finance.reconcileWorklist` (filter un-reconciled in period) → per-row `finance.reconcile` (EXISTING flip at :702) → row leaves the list. No schema, no new money path. Grouping by course requires the receipt→course join — verify the relation exists before committing to the `course` groupBy; if the join is indirect (via enrollment), document the path and index used.

## Related code files
- MODIFY `apps/api/src/routers/finance.ts` (add `revenueReport`, `revenueReportCsv`, `reconcileWorklist` — read-only; reuse existing `reconcile`).
- MODIFY `packages/auth/src/permissions.ts` (2 new perms).
- CREATE report + worklist components (e.g. `apps/admin/src/revenue-report.tsx`, `apps/admin/src/reconcile-worklist.tsx`) + route entries.
- (No schema, no migration.)

## Implementation Steps
1. Verify the receipt→course join path + confirm `issuedAt` vs `createdAt` is the correct period key (match the reconcile/report semantics operator expects).
2. Add `revenueReport` aggregate (month/facility/course) + perms.
3. Add CSV export (server-side string, UTF-8 BOM, integer VND).
4. Add `reconcileWorklist` (un-reconciled in period).
5. Build report + worklist UIs; wire worklist rows to the existing `reconcile` flip.

## Todo list
- [ ] verify course join + period-key semantics
- [ ] `revenueReport` aggregate + perms
- [ ] CSV export (BOM, VND, deterministic columns)
- [ ] `reconcileWorklist` query
- [ ] report + worklist UIs (reuse existing reconcile flip)

## Success Criteria
- Revenue by month / facility / course matches the sum of qualifying receipts (spot-checked against `dashboard.summary` all-time total).
- CSV opens cleanly in Excel-vi with correct VND numbers and column order.
- The worklist shows exactly the un-reconciled (approved/sent) receipts for the chosen period; reconciling one removes it from the list.
- All queries RLS-scoped: a facility user sees only their facilities' figures.

## Risk Assessment
- **Wrong period key (Med×Med)**: using `createdAt` vs `issuedAt` skews month totals → verify + document the chosen key before build.
- **Course join ambiguity (Med)**: indirect receipt→course path could double-count multi-enrollment receipts → verify cardinality; if 1:many, define the grouping rule (per-enrollment line vs per-receipt) explicitly.
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
