# Attendance penalty → payslip post-tax deduction

Date: 2026-07-02

## Status

Accepted

## Context

Attendance penalties (500đ/min late, 1000đ/min early) are already computed per-punch in
`check-in-out.ts:175-182` but never reach the payslip. `Payslip` has no deduction column
(`schema.prisma:1447-1477`), and neither `assemblePayslip` (pure math, `payslip.ts:69-94`)
nor `assembleSlipData` (DB-gathering, `payroll.ts:110-244`) references penalty data. The
`checkInOut.monthlyReport` permission is live but the procedure is dead — no
server-side aggregate, no UI.

## Decision

1. **Schema home (C1):** Add additive nullable columns to `Payslip`:
   `attendanceDeduction Int?`, `attendanceDeductionOverride Int?`,
   `attendanceDeductionOverrideReason String?`, plus an override actor field. KISS — no
   line-item table.

2. **Penalty is POST-TAX (C1):** `netIncome = gross − insurance − PIT −
   effectiveDeduction`. The deduction is subtracted after PIT so it does NOT distort
   taxable income. Non-negative guard: `effectiveDeduction` cannot make `netIncome` go
   below zero.

3. **Self-healing recompute (C2):** Penalty is aggregated from LIVE punch data INSIDE
   `assembleSlipData` on EVERY call — not injected once. `payslipOverrideVariablePay`
   rebuilds the whole slip via `assembleSlipData`; `payslipReopen` likewise re-derives.
   Therefore any override or reopen recomputes (not wipes) the penalty. The director
   "miễn/giảm" control is its OWN field (`attendanceDeductionOverride` + reason), applied
   on top of the recomputed base — never the `variablePay` mechanism (which is
   commission). `effectiveDeduction = override ?? aggregatedFromPunches`.

4. **ICT (+7) month bucketing (M6):** Punch timestamps are stored UTC; penalties must be
   bucketed by ICT (UTC+7) day/month boundaries so a 23:xx ICT punch on the last day of
   the month lands in the correct month even when the next-day UTC crosses over.

5. **Finalize freezes; reopen re-derives (N6):** Once a payslip is finalized, the
   deduction is frozen. Reopening re-aggregates from live punches (which may have changed
   if punches were approved after the original compute).

6. **`monthlyReport` server-side aggregate (M5):** A real procedure aggregates month
   punches per staff (workdays, late/early minutes, penalty total), facility-scoped, gated
   on `checkInOut.monthlyReport` perm. Director drill-down uses this server-side aggregate
   — NOT the per-user `history`/`canViewStaffPunch` guard (which excludes directors and
   would FORBIDDEN).

## Alternatives Considered

1. Inject penalty as a `variablePay` tweak. Rejected: `payslipOverrideVariablePay` wipes
   and rebuilds the whole slip — a penalty injected as variablePay would be silently
   overwritten on any commission override (CRITICAL, C2).
2. Compute penalty once at finalize and freeze. Rejected: not self-healing — punches
   approved after finalize-but-before-reopen would be lost; reopen would not re-derive.
3. Pre-tax deduction. Rejected: would distort PIT calculation and taxable income
   reporting.

## Consequences

Positive:

- Attendance penalties become real, visible payslip deductions.
- Override/reopen recomputes from live data — no silent wipes.
- Taxable income is undistorted.
- Directors get a real monthly report with drill-down (no FORBIDDEN).

Tradeoffs:

- `assembleSlipData` gains a punch-aggregation query on every call — performance
  consideration for large facilities (mitigated by date-range scoping).
- Two migrations in the chain (P1 EmploymentProfile + P4 Payslip) — replay both for
  0-drift.

## Follow-Up

- Unit tests: `assemblePayslip` post-tax math; ICT boundary bucketing; single/>2-punch-day
  aggregation; non-negative guard.
- Integration: deduction matches punch sum; override reduces + audited; finalize locks;
  reopen re-derives; `payslipOverrideVariablePay` does NOT wipe deduction.
- DEBT: independent of KPI tuan_thu ratio + cumulative attendance-transfer blend.
