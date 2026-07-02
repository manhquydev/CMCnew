# Cross-Plan Integration Review: Payroll/KPI/Commission Chain

## Findings (ranked)

### HIGH — commission override silently reverts on payslip recompute (Q1)
`apps/api/src/routers/payroll.ts:643-656` (`payslipCompute`) threads
`attendanceDeductionOverride: existing?.attendanceDeductionOverride` into
`assembleSlipData`, so a prior attendance-penalty override survives a
recompute. But it does **not** thread any equivalent for `variablePay` — no
`variablePayOverride` is passed, per the comment at line 655
("No variablePayOverride → sales auto-feed runs normally"). Unlike attendance
deduction, `variablePay`/`variableNote` have **no separate override column**
in schema (`packages/db/prisma/schema.prisma:1526-1527` only has
`variable_pay`/`variable_note`, no `variable_pay_override`).

Reproduction: HR runs `payslipCompute` → sales staff gets auto-fed commission
X. Tree-manager runs `payslipOverrideVariablePay` to correct commission to Y
(reason logged). HR later re-clicks "Tính lương" (`apps/admin/src/payroll-panel.tsx:211`,
which calls `payslipCompute` on the same draft to fix e.g. workdays or
insurance) → `assembleSlipData` reruns the sales auto-feed from receipts,
silently overwriting `variablePay` back to X and replacing `variableNote`
with the auto-feed note, discarding Y and the override's audit reason with no
warning to the user. Confirmed no test covers "override then recompute"
(`apps/api/test/payslip-commission-override.int.test.ts` only calls
`payslipCompute` once, before the override).

Fix: either persist `variablePayOverride`/`variableNoteOverride` as columns
(mirroring `attendanceDeductionOverride`) and thread them through
`payslipCompute` like attendance, or block `payslipCompute` from recomputing
`variablePay` when an override reason exists on the slip (require explicit
"clear override" action first).

### Non-issue — attendance deduction display field (Q1 sub-check)
`assembleSlipData` (`payroll.ts:292`) returns `attendanceDeduction:
liveAttendanceDeduction` (not the override), while `netIncome` is computed
from `effectiveAttendanceDeduction` (override-aware). This looked like a
mismatch at first read but is intentional: schema keeps `attendanceDeduction`
as the live/audit figure and `attendanceDeductionOverride` as the separate
override column (`schema.prisma:1529-1531`); `payslipOverrideAttendanceDeduction`
(`payroll.ts:990`) computes `netIncome` directly from `slip.grossIncome -
insurance - pit - input.amount`, bypassing the live figure correctly. No
clobbering between the two override paths — attendance override is correctly
preserved through `payslipOverrideVariablePay`'s call (`payroll.ts:936`).

### Non-issue — KPI cross-approval permissions (Q2)
`packages/auth/src/permissions.ts:220-221`: both `kpiEvalConfirm` and
`kpiEvalApprove` still list both director roles
(`giam_doc_kinh_doanh`, `giam_doc_dao_tao`), unchanged from the fix. Router
confirms the design is intact: `kpiEvalConfirm` still calls
`assertCanManagePayrollTarget` (domain-scoped, correct for confirm step,
`payroll.ts:1164`); `kpiEvalApprove` explicitly has no domain-scope check
(`payroll.ts:1205-1206`, comment cites decision 0023), relying on
`requirePermission` + separation-of-duties checks (`row.userId ===
ctx.session.userId`, `row.confirmedById === ctx.session.userId`). This
session's new grants (commission/attendance-payroll/onboarding/CRM) did not
touch this block.

### Non-issue — rewards/refund isolation (Q3)
`packages/domain-payroll/src` has zero references to star-adjustment or
refund-ledger symbols; no shared helpers or schema collision found.

### Non-issue — staff vs. student attendance separation (Q4)
`attendanceDeductionForUser` (`payroll.ts:106-143`) sources only from
`shiftRegistrationEntry`/`timePunch` (work-shift domain) via
`summarizeAttendance`. `isMakeup` only appears in
`attendance.ts`/`schedule.ts`/`exercise-open.ts`/`curriculum-recompute.ts` —
none reachable from `payroll.ts`. Confirmed fully separate domains, no
accidental coupling.

## Unresolved Questions
- Was `variablePayOverride` intentionally left non-persistent (i.e., is
  "recompute clears manual commission override" accepted product behavior)?
  If so it should at minimum surface a UI warning before recompute proceeds
  on a slip carrying an override reason.
