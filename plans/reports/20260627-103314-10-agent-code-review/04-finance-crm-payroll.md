# 04 Finance, CRM, Payroll

Status: DONE_WITH_CONCERNS

## Scope Reviewed

- `packages/domain-finance/**`
- `packages/domain-payroll/**`
- `apps/api/src/routers/finance.ts`
- `apps/api/src/routers/crm.ts`
- `apps/api/src/routers/payroll.ts`
- `apps/api/src/routers/compensation.ts`
- relevant tests/specs/reference docs

## Findings

### High: Receipt commission attribution can attach to unrelated opportunities

Evidence:

- `apps/api/src/routers/finance.ts:155`
- `apps/api/src/routers/finance.ts:213`
- approval reads owner/stage at `apps/api/src/routers/finance.ts:476`
- payroll commission uses `soldById`: `apps/api/src/routers/payroll.ts:126`

Impact: wrong opportunity can misclassify kind and credit wrong salesperson.

### High: CRM actors can set arbitrary opportunity owner

Evidence:

- `apps/api/src/routers/crm.ts:108`
- `apps/api/src/routers/crm.ts:120`
- role permission: `packages/auth/src/permissions.ts:84`

Impact: non-manager CRM users can steer future commission attribution.

### High: Sales KPI auto-prefill undercounts non-approved terminal receipts

Evidence:

- commission counts approved/sent/reconciled: `apps/api/src/routers/payroll.ts:129`
- KPI prefill counts only approved: `apps/api/src/routers/payroll.ts:975`
- test only seeds approved: `apps/api/test/kpi-auto-prefill.int.test.ts:75`

Impact: reconciled/sent receipts still pay commission but disappear from sales KPI.

### High: KPI confirm/approve lacks manager-tree/self checks

Evidence:

- helper exists: `apps/api/src/lib/kpi-authz.ts:18`
- confirm only checks status: `apps/api/src/routers/payroll.ts:831`
- approve only blocks approver == confirmer: `apps/api/src/routers/payroll.ts:864`

Impact: same-facility managers can approve rows outside their tree; BGD can approve own KPI if someone else confirmed.

### Medium: Approved KPI can still be overridden

Evidence:

- approved state at `apps/api/src/routers/payroll.ts:886`
- `kpiOverride` no status gate at `apps/api/src/routers/payroll.ts:1090`

Impact: approved KPI can affect payslip without reapproval.

### Medium: Salary grade can be cleared without reason

Evidence:

- optional grade schema: `apps/api/src/routers/payroll.ts:204`
- reason check truthy-only: `apps/api/src/routers/payroll.ts:220`

Impact: empty string bypasses grade-change reason/audit intent.

## Verification Gaps

- No negative test for mismatched receipt/opportunity.
- No test that ordinary CRM roles cannot set arbitrary owner.
- No KPI prefill tests for sent/reconciled.
- KPI workflow tests miss self/non-tree cases.

## Positive Controls

- Voucher consume uses atomic SQL.
- Receipt approval has draft claim guard.
- Receipt code allocation uses advisory lock.
- Money math uses integer VND and explicit rounding.
- Payslip finalize blocks recompute.
- Self payslip view uses session user and hides drafts.

## Unresolved Questions

- Should `quan_ly` create/approve/cancel receipts?
- Should approved KPI be immutable except formal reopen/reapproval?
- Should web leads have a default owner?

