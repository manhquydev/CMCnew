# Phase 3 completion — revenue report + reconciliation worklist

## Files modified
- `apps/api/src/routers/finance.ts` — added `revenueReport`, `revenueReportCsv`, `reconcileWorklist` (read-only; `reconcileWorklist` reuses the existing `receiptReconcile` mutation). Exported `csvText` for unit testing. No other procedures touched.
- `packages/auth/src/permissions.ts` — added `finance.revenueReport`, `finance.reconcileWorklist` (grantees: `ke_toan`, `giam_doc_kinh_doanh`), appended after the concurrent P2 `sendReceiptEmail` entry.
- `apps/api/test/fixtures/permission-snapshot.json` — added the 2 new entries.
- `apps/admin/src/shell.tsx` — added `revenue-report` / `reconcile-worklist` to `SectionKey`, nav items under "Tài chính" group, `SECTION_TITLES`.
- `apps/admin/src/nav-permissions.ts` — added `NAV_GATES` entries for both new sections.
- `apps/admin/src/App.tsx` — imports, `ALL_SECTION_KEYS`, switch cases for the two new panels. Did **not** touch `finance-panel.tsx`.
- NEW `apps/admin/src/revenue-report.tsx` — period picker + groupBy toggle + table + CSV export.
- NEW `apps/admin/src/reconcile-worklist.tsx` — period picker + facility filter + table + per-row "Đối soát" reusing `finance.receiptReconcile`.
- NEW `apps/api/test/revenue-report-reconcile-worklist.int.test.ts` — 6 integration tests against the real dev DB.
- NEW `apps/api/test/finance-csv-formula-guard.unit.test.ts` — 7 unit tests for the CSV guard function.

## Tasks completed
- [x] Period key = `approvedAt`; course grouping via direct `courseId` FK
- [x] `revenueReport` aggregate (gross − refunds = net) + perms
- [x] CSV export (BOM, VND, gross/refunds/net columns, formula-injection guard)
- [x] `reconcileWorklist` query (approvedAt-bucketed, reuses existing `receiptReconcile`)
- [x] Report + worklist UIs
- [x] Documented retroactive-cancel (live-ledger) semantics in code comments

## Design notes / decisions made during build
- Router uses `receiptReconcile` (actual name) throughout — the plan's context section referenced `finance.ts:702` / "reconcile" informally; the real existing mutation is `receiptReconcile`, confirmed by reading the file before editing.
- Refunds are bucketed by `RefundRecord.createdAt`, gross by `Receipt.approvedAt` — implemented as two separate raw-SQL aggregates merged in JS by bucket key (month via `to_char`, facility via `facility_id`, course via `course_id`, with a `receipt` JOIN for the course-grouped refund bucket since `RefundRecord` has no `courseId`).
- Raw SQL runs inside the same `withRls`-scoped transaction as every other query in this router, so RLS applies automatically — no manual facility filtering needed beyond the optional `facilityId` param on `reconcileWorklist`.
- Date range capped at 3 years and `from < to` enforced via zod `.refine` (Risk Assessment: "unbounded period → cap the range").
- **CSV formula-injection finding**: the guard (`csvText`, exported) is implemented and unit-tested directly, but in the live pipeline it is **unreachable** — every grouped label is prefixed with the entity's system-assigned `code` ("HQ — Tên cơ sở" / "CRS001 — Tên khóa" / "Tháng M/Y"), so a malicious facility/course *name* starting with `=`/`+`/`-`/`@` never lands at cell position 0. Verified this empirically: seeded a facility named `=1+1+cmd|calc` and confirmed the CSV cell reads `CODE — =1+1+cmd|calc` (safe) rather than a raw `=1+1+cmd|calc` at cell start. Documented as a non-issue in code comments per the audit guidance (fix real failure modes, document non-issues) — the guard stays in place as defense-in-depth and is proven correct via a direct unit test against the function.
- `reconcileWorklist` does not include a `facility` relation select — `Receipt` has no `facility` relation field in the Prisma schema (only `facilityId Int`), confirmed via `schema.prisma:1022-1080`. The admin UI resolves the facility label client-side from the already-loaded `facility.list` query (same pattern `finance-panel.tsx` uses for receipts).
- No batch-reconcile action was added (plan left it optional, default per-row on ambiguity — kept YAGNI).

## Tests status
- Type check: **pass** (`pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/admin typecheck`)
- Integration tests (real dev DB, no mocks): **6/6 pass** — `apps/api/test/revenue-report-reconcile-worklist.int.test.ts`
  - (a) gross by month/facility/course vs hand-computed sum ✓
  - (b) net = gross − refunds via the real `refundCreate` flow (Phase 1's guarded mutation, not a hand-inserted row) ✓
  - (c) retroactive-cancel drops a receipt from its approval month's gross on re-run, asserted as expected behavior ✓
  - (d) CSV: BOM + column order + malicious-label safety finding ✓
  - (e) `reconcileWorklist` exact approved/sent-only filtering; reconciling one removes it from the list ✓
  - (f) RLS facility scoping (facility-B caller excludes facility-A figures) ✓
- Unit tests: **7/7 pass** — `apps/api/test/finance-csv-formula-guard.unit.test.ts`
- `permission-parity.test.ts`: 26/26 pass (snapshot updated for the 2 new finance perms)
- `nav-consistency.test.ts`: the general registry-sync assertion (covers both new nav gates) passes in isolation. One named test (`D3: ... payroll.kpiList`) fails, but it's **pre-existing drift from a concurrent phase's payroll grant change** (`packages/auth/src/permissions.ts` `payroll.kpiList` no longer includes `hr`) — outside this phase's file ownership (finance.ts / the finance block of permissions.ts / the two new UI files), not caused by or fixable within this task's scope.

## Issues encountered
- `finance.ts` and `permissions.ts` were being concurrently edited by other phases (P2 email, P4 discount-tier) throughout this session — re-read both files immediately before each edit to avoid clobbering; all edits landed cleanly against the latest concurrent state.

Status: DONE
Summary: Revenue report (month/facility/course, gross−refunds=net) + CSV export + reconciliation worklist shipped as pure read-only additions reusing the existing `receiptReconcile` flip; 13 new tests pass against the real dev DB, both packages typecheck clean, `finance-panel.tsx` untouched.
Concerns/Blockers: One unrelated pre-existing nav-consistency test failure (payroll.kpiList/hr) from a concurrent phase — flagging for the orchestrator, not blocking this phase.
