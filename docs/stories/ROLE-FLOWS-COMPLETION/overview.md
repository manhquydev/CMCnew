# Overview

## Current Behavior

The money-chain and people-chain have broken seams:

- **Commission:** Sale closes an opportunity at O4 but cannot create a receipt. Finance
  creates receipts without `opportunityId`, so commission attribution has no link to the
  originating opportunity. No auto-advance to O5 on receipt approval — "won" metrics and
  `kind` (new/renewal) are stale.
- **Attendance→payroll:** Penalties (500đ/min late, 1000đ/min early) are computed
  per-punch but never reach the payslip. `Payslip` has no deduction column.
  `checkInOut.monthlyReport` permission is live but the procedure is dead.
- **HR onboarding:** `EmploymentProfile` lacks `address`/`nationalId`(CCCD)/`bankAccount`/
  `bankName`. No sensitive-field masking or role-gated read. `managerId` cannot be set via
  `profileUpsert`, so shift approval always falls back to directors.
- **Shift approval:** Approve/reject is directors-only; assigned `managerId` cannot
  approve own staff's packets. No withdraw button (perm exists, UI missing). Notif only
  goes to `managerId` (null → silent).
- **CRM hygiene:** `crm.contactList` exists with 0 callers. Phone-dedupe runs silently
  server-side — duplicates slip through. `afterSale.*` excludes sale, so all CSKH cases
  route to the business director.

## Target Behavior

- Sale creates a draft receipt from the opportunity detail page (opportunityId
  auto-linked) → director/ke_toan approves → commission `soldById`/`kind` correct + opp
  auto → O5. Sale retains read-only visibility of own receipts. Cancel reverts the
  auto-advanced opp.
- Monthly payslip has a POST-TAX late/early deduction matching ICT-bucketed punches;
  director can override pre-finalize; finalize locks; reopen re-derives.
- Director "Báo cáo công tháng" shows all facility staff with drill-down.
- New-staff single form: email+phone+name+role+facility+manager+startedAt+(address/CCCD/
  bank) → SSO login works, has profile+rate, shift packets route to manager. CCCD/bank
  masked for non-privileged; audited on change.
- Assigned manager approves own staff's shift packet; cannot self-approve; both directors
  approve any packet. Withdraw button works. Notif reaches nextManagerId.
- Contact directory searchable by phone/name; creating an opportunity on an existing phone
  warns with open opportunities. Sale handles afterSale cases within own facility.

## Affected Users

- `sale` — gains receiptCreate (draft) + receiptListOwn (read-only) + afterSale.* +
  listAssignableForAfterSale.
- `giam_doc_kinh_doanh` — approves receipts (auto-O5), views monthly report with drill-down,
  overrides payslip penalties, approves any shift packet.
- `giam_doc_dao_tao` — same as above for teacher domain.
- `ke_toan` — approves receipts (unchanged perm).
- `staff` (team leads with managerId set) — approves own staff's shift packets.
- All staff — onboarding form captures full record; sensitive fields masked.

## Affected Product Docs

- `docs/decisions/0024-commission-sale-draft-receipt-auto-o5.md`
- `docs/decisions/0025-attendance-penalty-payroll-deduction.md`
- `docs/decisions/0026-hr-sensitive-record-mask-only.md`
- `docs/decisions/0027-delegated-shift-approver.md`
- `plans/260702-1030-role-flows-completion/plan.md` + phase files
- `DEBT.md` (column encryption deferred + existing items)

## Non-Goals

- Column-level encryption for CCCD/bank (deferred to DEBT, decision 0026).
- Web-lead inbox (DEBT); Callio sync (DEBT); MS Graph provisioning ADR 0015 (Proposed-only).
- Badge admin UI (DEBT, Plan 6 scope).
- Adding a PR-level integration-test stage to Jenkinsfile for develop branch (out of scope).
- KPI tuan_thu ratio + cumulative attendance-transfer blend changes (independent).
