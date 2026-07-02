# Design

## Domain Model

- **Commission chain:** `Opportunity` (O4 → O5_ENROLLED) links to `Receipt` via
  `opportunityId`. `receiptApprove` advances opp + stamps `closedAt` + clears
  `lostReason` (WON invariant). `receiptCancel` reverts if it was the sole auto-advancing
  receipt. `kind` (new/renewal) computed treating surviving opp as O5 before stage update.
- **Attendance penalty:** `Payslip.attendanceDeduction` (post-tax). Aggregated from live
  `TimePunch` data in `assembleSlipData` on every call (self-healing). Director override
  via own field (`attendanceDeductionOverride` + reason + actor). ICT (+7) month
  bucketing. Finalize freezes; reopen re-derives.
- **HR sensitive record:** `EmploymentProfile` gains `address`, `nationalId`, `bankAccount`,
  `bankName` (nullable, plaintext). `maskSensitive(value)` + `canReadSensitiveHr(session)`
  gate full-value read. Audit-on-change (field name only, never raw value).
- **Delegated approver:** `assertAssignedApprover` checks assigned `managerId` OR director
  role bypass. Anti-self-approve retained. `managerId` validated in `profileUpsert` (≠ self,
  active co-facility, no A↔B cycle).

## Application Flow

- **Commission:** sale → opportunity-detail "Tạo phiếu thu" → `receiptCreate` (draft,
  opportunityId) → director/ke_toan `receiptApprove` → auto-O5 + commission stamp →
  sale views via `receiptListOwn` (collectedById=self).
- **Penalty:** `assembleSlipData` queries `TimePunch` for month, aggregates penalty by
  ICT boundaries → `assemblePayslip` subtracts post-tax → `payslipOverrideVariablePay`
  re-derives (not wipes) → `payslipFinalize` freezes.
- **Onboarding:** `user.create` (email/name/roles/facility/phone) → `profileUpsert`
  (managerId/startedAt/sensitive) + `rateCreate` → SSO login.
- **Shift approve:** `shiftRegistration.approve` → `assertAssignedApprover`
  (assigned managerId OR director) → supersede old → notif to managerId + nextManagerId.

## Interface Contract

- `finance.receiptCreate` — input gains `opportunityId` (already accepted server-side);
  perm += `sale`.
- `finance.receiptListOwn` — NEW read-only procedure, scope `collectedById = self`.
- `finance.receiptApprove` — auto-advances linked opp to O5 + stamps closedAt (idempotent).
- `finance.receiptCancel` — reverts auto-advanced opp to O4 if sole approved receipt.
- `payroll.profileUpsert` — input += `managerId`, `address`, `nationalId`, `bankAccount`,
  `bankName`; managerId validated (M8).
- `payroll.payslipCompute` — `assembleSlipData` aggregates penalty; `assemblePayslip`
  subtracts post-tax.
- `payroll.payslipOverrideVariablePay` — re-derives penalty (not wipes).
- `checkInOut.monthlyReport` — NEW server-side aggregate procedure (facility-scoped).
- `shiftRegistration.approve`/`reject` — perm += `staff`; `assertAssignedApprover` gains
  director bypass.
- `afterSale.{list,create,transition,assign}` — perm += `sale`.
- `user.listAssignableForAfterSale` — perm += `sale`.
- Profile read resolver — masks CCCD/bank unless `canReadSensitiveHr`.

## Data Model

- `employment_profile`: + `address`, `national_id`, `bank_account`, `bank_name` (all
  nullable, additive). Migration: P1.
- `payslip`: + `attendance_deduction`, `attendance_deduction_override`,
  `attendance_deduction_override_reason`, override actor (all nullable, additive).
  Migration: P4 (serialized after P1).
- No new tables. No RLS policy changes (new columns inherit table policy).
- Two migrations in chain: P1 (EmploymentProfile) → P4 (Payslip). Replay both for 0-drift.

## UI / Platform Impact

- `apps/admin/src/finance-panel.tsx` — forwards opportunityId (both call sites).
- `apps/admin/src/opportunity-detail.tsx` — "Tạo phiếu thu" button + prefill + read-only
  linked-receipt status.
- `apps/admin/src/staff-profile.tsx` — extends onboarding form (managerId + sensitive).
- `apps/admin/src/App.tsx` — UserCreateModal gains onboarding fields.
- `apps/admin/src/shift-reg-detail-panel.tsx` — withdraw button + approve for leads.
- `apps/admin/src/crm-panel.tsx` — dup-phone warning in createLead.
- New: contact-directory panel, monthly-report panel, punch-history UI.

## Observability

- `logEvent` audit on: opp stage change (auto-O5 / cancel-revert), sensitive-field change
  (field name only), payslip penalty override (actor + reason + amount), shift approve/
  reject (actor + supersede).
- No raw CCCD/bank values ever logged.
- monthlyReport is a server-side aggregate (no per-user guard bypass logging needed).

## Alternatives Considered

1. Inject penalty as variablePay — rejected (wiped on override, C2 CRITICAL).
2. Pre-tax deduction — rejected (distorts PIT).
3. Column encryption now — rejected (no infra, KISS, DEBT).
4. Directors-only shift approval — rejected (bottleneck).
5. Keep sale out of receipts — rejected (commission chain broken).
