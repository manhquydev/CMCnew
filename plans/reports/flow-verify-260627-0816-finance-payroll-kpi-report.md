# Flow Verify — Finance / Payroll / KPI (live API)

Date: 2026-06-27 · API: http://localhost:4000 · Auth: super_admin (admin@cmc.local)
Scope: tRPC-over-curl against seeded dev DB (facility 1). No source modified.

## Auth note (scope limiter)
SSO is enabled (`ssoConfigFromEnv()` truthy), so password login is **break-glass super_admin only**.
`hr@`, `quanly@`, `bgd@`, `ketoan@` all return `FORBIDDEN "Nhân viên đăng nhập bằng tài khoản CMC EDU (SSO)"`.
Role-specific multi-actor steps (full KPI hr→quanly→bgd chain, ke_toan-scoped approve) were therefore
run as super_admin where the proc accepts a target `userId`, and the employee-self `kpiEvalSubmit` was
exercised against the super_admin user. Cross-actor separation-of-duties was still verifiable (below).

## Step → Result

| # | Step | Input | Result | Verdict |
|---|------|-------|--------|---------|
| 1 | Login super_admin | admin@cmc.local | session super_admin, facility [1] | PASS |
| 2 | finance.priceCreate | 10,000,000đ/yr eff 2026-01-01, course 3a56c0e4 | price 4fccfe5a | PASS |
| 3 | receiptCreate (existing student, 1yr) | Sale Student | gross 10,000,000 · tier 15% · **net 8,500,000** | PASS (10M×0.85) |
| 4 | receiptApprove | RID e7739672 | code PT-2026-1059 · status approved · kind=new · soldById=null | PASS |
| 5 | receiptApprove again (edge) | same | `BAD_REQUEST "không ở trạng thái nháp"` | PASS (idempotent guard) |
| 6 | crm.contactCreate | 0912345678 | normalized +84912345678 | PASS |
| 7 | crm.opportunityCreate | owner=sale 0bf89b55 | stage O1, owner=sale | PASS |
| 8 | crm.opportunityTransition → O5 | | stage O5_ENROLLED, closedAt set | PASS |
| 9 | voucherCreate VFLOW10 | 10%, max 5 | voucher 828d3cb3 | PASS |
| 10 | receiptCreate (2yr + VFLOW10 + opp) | | gross 20,000,000 · tier 20% + voucher 10% = **eff 30%** · net 14,000,000 | PASS (cap math OK) |
| 11 | receiptApprove (opp-linked) | RID 99e38850 | PT-2026-1063 · **soldById=sale** · **kind=new** (O5) | PASS (attribution frozen) |
| 12 | receiptCreate (NEW-student path) | parentPhone 0987000111 | draft, studentId=null, fields carried | PASS |
| 13 | receiptApprove (provision) | RID 8da7f14a | PT-2026-1064 · student 321478e2 created | PASS |
| 14 | receiptCancel (void path) | reason given | status cancelled; student 321478e2 archived (gone from student.list) | PASS (void_student rollback) |
| 15 | payroll.profileUpsert (sale) | grade CV4 | profile 9bad0cd1 | PASS |
| 16 | payroll.rateCreate (sale) | base 15M, meal 1M, kpiMax 3M, quota 20M | rate ef225cff | PASS |
| 17 | commissionForSale preview 2026-06 | | newRev 14M, attain 0.7, rateNew 0.01, **commission 140,000**, budgetCap 840,000 | PASS |
| 18 | payslipCompute 2026-06 (kpi 90, 22/22) | | base 15M + allow 1M + kpiBonus 3M(A,1.0) + var 140k → gross 19,140,000 · taxable 8,140,000 · PIT 564,000 · **net 18,576,000** | PASS (matches hand-calc) |
| 19 | payslipCompute again (idempotency) | same | same id, same net 18,576,000 | PASS |
| 20 | receiptCancel 14M opp receipt + recompute | | variablePay **140k → 0**, gross 19,000,000, net 18,450,000 | PASS (cancelled drops from commission) |
| 21 | payslipFinalize | | status finalized | PASS |
| 22 | payslipCompute after finalize (edge) | | `CONFLICT "đã chốt — không tính lại được"` | PASS (lock) |
| 23 | payslipMarkPaid | | status paid, paidAt set | PASS |
| 24 | payslipMarkPaid again (edge) | | `BAD_REQUEST "Chỉ đánh dấu trả cho phiếu đã chốt"` | PASS (lock) |
| 25 | kpiEvalStart (training, 2026-06) | super_admin self | status draft | PASS |
| 26 | kpiEvalSubmit (self) | 90/80/70 | **autoScore 84** (90·0.6+80·0.2+70·0.2), submitted | PASS (weighted KPI correct) |
| 27 | kpiEvalConfirm | | status confirmed | PASS |
| 28 | kpiEvalApprove (self-confirmed) | | `FORBIDDEN "Không thể duyệt phiếu do chính mình xác nhận"` | PASS (separation-of-duties guard) |
| 29 | kpiSetAuto (sale, sales, 70) | | autoScore 70 | PASS |
| 30 | kpiOverride (sale, →92, reason) | | autoScore 70 kept, **overrideScore 92** + reason audited | PASS |
| 31 | payslipCompute draft 2026-07 (kpi 80) | sale | gross 18,400,000 · kpiBonus 2,400,000(B) · net 17,910,000 | PASS |
| 32 | payslipOverrideVariablePay (→500k, reason) | sale 2026-07 | var 500k set BUT **kpiScore 80→0, kpiGrade B→D, kpiBonus 2.4M→0**, net 16,200,000 | **FAIL — see Bug 1** |

## Server log
`grep -iE 'error|unhandled|500|prisma|stack' /tmp/cmc-api-dev.log` → **no matches**.
Log only holds the 5-line startup banner; no unhandled exceptions, 500s, or Prisma stack traces during the
entire run. All negative-path results above are *handled* `TRPCError`s (expected guards), not crashes.

## FINDINGS

### Bug 1 (Medium-High, money correctness) — commission override silently wipes KPI bonus
`payroll.payslipOverrideVariablePay` recomputes the slip via `assembleSlipData` with `kpiScoreInput`
left **undefined**, which re-resolves the KPI score from the `KpiScore` record (`overrideScore ?? autoScore`).
When the original `payslipCompute` was driven by an **inline `kpiScore` input** (a supported schema field)
and **no `KpiScore` row exists for that (user, period)**, the override re-resolves KPI to **0** → grade D →
`kpiBonus` 0. Observed: step 31 net 17,910,000 (kpiBonus 2,400,000) → step 32 net **16,200,000**, kpiBonus 0,
even though the manager only touched `variablePay`. Effect: a tree-manager adjusting commission on a draft
slip can **silently underpay** the employee by the entire KPI bonus.
- Root cause: divergence between `payslipCompute` (persists arbitrary `kpiScore` onto the payslip but NOT
  into a `KpiScore` record) and `payslipOverrideVariablePay` (re-derives `kpiScore` only from `KpiScore`).
- File: `apps/api/src/routers/payroll.ts` — `assembleSlipData` (kpiScore resolution ~L102-112) and the
  override caller (~L650-662, `kpiScoreInput` intentionally omitted).
- Suggested fix direction (not applied — no source edits per task): in `payslipOverrideVariablePay` pass
  `kpiScoreInput: slip.kpiScore` so the override preserves the slip's frozen KPI, OR have `payslipCompute`
  persist its resolved score into `KpiScore`. The code comment claims "re-resolved so the latest score
  applies" — that assumption breaks when KPI never came from a `KpiScore` row.
- Note: in the standard KPI workflow (kpiEvalStart→…→approve) a `KpiScore` row exists, so the bonus is
  preserved; the bug surfaces on the inline-kpiScore path that `payslipCompute` explicitly supports.

## Correctness spot-checks (all PASS)
- Discount stacking + 35% cap: tier 20% + voucher 10% = 30% (under cap), net 14M exact.
- PIT progressive: taxable 8,140,000 → 250,000 (5M·5%) + 314,000 (3.14M·10%) = 564,000 exact.
- Commission band: attainment 0.7 → band <0.8 → rate 0.01 → 14,000,000·0.01 = 140,000 exact.
- KPI weighted: 84 from sales/training criteria weights — correct.
- Commission claw-back on cancel: status filter (approved/sent/reconciled) naturally excludes cancelled — verified live.
- void_student rollback on cancelling a provisioning receipt with no attendance/other receipts — verified (student archived).
- refund_only: cancelling the 14M receipt on a pre-existing student left the student untouched — correct.

## Unresolved questions
1. Is the inline `kpiScore` input to `payslipCompute` an intended production path, or only a test seam?
   If production, Bug 1 is a live underpayment risk; if test-only, lower severity but still a latent trap.
2. Full KPI approval chain (hr→quanly→bgd) and ke_toan-scoped receipt approval could not be exercised
   end-to-end because non-super_admin accounts are SSO-gated. Recommend a dev-mode seam or SSO test creds
   to verify role-boundary authorization (requirePermission) for those roles.
