# Exec Plan

## Goal

Close the money-chain (commission attribution + attendance penalties into payslip) and
people-chain (full HR onboarding record + delegated shift approval + CRM hygiene) gaps
across sale / giáo viên / 2 directors.

## Scope

In scope:

- P1: EmploymentProfile 4 new columns + migration + mask/authz helper design.
- P2: HR onboarding — user.create phone + profileUpsert extend (managerId + sensitive) +
  onboarding form + masking + managerId validation (M8).
- P3: Commission chain — perm + opp→draft-receipt button + opportunityId pass-through +
  auto-O5 on approve + cancel revert + sale read-only visibility.
- P4: Attendance→payroll — Payslip deduction columns + post-tax penalty in
  assembleSlipData/assemblePayslip + override + ICT bucketing + monthlyReport +
  history UI + withdraw + delegated approver + notif fix.
- P5: CRM hygiene — contact directory + dup-phone warning + sale afterSale perm.
- P6: Validation — parity snapshot regen + int + e2e + 4 decisions + DEBT + harness trace.

Out of scope:

- Column-level encryption for CCCD/bank (DEBT).
- Web-lead inbox, Callio sync, badge admin UI (DEBT / Plan 6).
- KPI tuan_thu ratio + attendance-transfer blend changes.

## Risk Classification

Risk flags:

- Authorization (sale gains finance.receiptCreate + afterSale.*; delegated shift
  approve/reject opened to staff; managerId validation).
- Data model (EmploymentProfile new columns incl. sensitive CCCD/bank + migration;
  Payslip deduction columns + migration).
- Audit/security (CCCD/bank sensitive read-gate + audit-on-change; payslip override
  audited).
- Existing behavior (payslipCompute money math changes; receiptApprove auto-advances opp
  stage; receiptCancel reverts opp).
- Public contracts (new finance.receiptListOwn procedure; submission save not touched).

Hard gates:

- Authorization.
- Data model (migration).
- Audit/security (sensitive data).

≥4 flags + 3 hard gates → **high-risk lane**.

## Work Phases

1. P1 — Schema: EmploymentProfile columns + migration + mask/authz helper (completed 2026-07-02).
2. P2 — HR onboarding: full record API + UI + masking + managerId validation (completed 2026-07-02).
3. P3 — Commission chain: perm + draft-receipt button + auto-O5 + cancel revert +
   sale visibility (completed 2026-07-02).
4. P4 — Attendance→payroll: deduction columns + post-tax penalty + monthlyReport +
   history UI + withdraw + delegated approver + notif (completed 2026-07-02).
5. P5 — CRM hygiene: contact directory + dup-phone warning + afterSale perm
   (completed 2026-07-02).
6. P6 — Validation: parity snapshot + int + e2e + decisions + DEBT + harness trace
   (pending).

Serialization: `permissions.ts` edited P3 → P4 → P5 (sequential, regen snapshot ONCE at
P6). `schema.prisma` edited P1 → P4 (P4 depends on P1, no parallel collision).

## Stop Conditions

Pause for human confirmation if:

- The seam-fixes P5 profileUpsert/rateCreate form does NOT exist (M4 hard gate at P2
  start — re-grep; fold-in build if absent).
- Migration drift appears (mandatory 0-drift replay before merge).
- A permission broadening creates an unintended cross-facility or self-approve path.
- The auto-O5 advance or cancel-revert violates the WON invariant in testing.
